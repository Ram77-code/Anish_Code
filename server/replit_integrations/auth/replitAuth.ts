import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { randomBytes } from "crypto";
import { authStorage } from "./storage";

type GitHubUserResponse = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
};

type GitHubEmailResponse = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

function getBaseUrl(req: any): string {
  return process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
}

async function upsertUser(user: {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}) {
  await authStorage.upsertUser({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  const beginGithubAuth = (req: any, res: any) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ message: "Missing GITHUB_CLIENT_ID" });
    }

    const state = randomBytes(24).toString("hex");
    req.session.oauthState = state;

    const redirectUri =
      process.env.GITHUB_CALLBACK_URL || `${getBaseUrl(req)}/api/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
      allow_signup: "true",
    });

    return res.redirect(
      `https://github.com/login/oauth/authorize?${params.toString()}`
    );
  };

  app.get("/api/login", beginGithubAuth);
  app.get("/api/login/github", beginGithubAuth);

  app.get("/api/callback", async (req: any, res) => {
    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;
      const storedState = req.session.oauthState as string | undefined;

      if (!clientId || !clientSecret) {
        return res
          .status(500)
          .json({ message: "Missing GitHub OAuth environment variables" });
      }
      if (!code || !state || !storedState || state !== storedState) {
        return res.status(400).json({ message: "Invalid OAuth state or code" });
      }

      const redirectUri =
        process.env.GITHUB_CALLBACK_URL || `${getBaseUrl(req)}/api/callback`;
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            state,
          }).toString(),
        }
      );

      if (!tokenResponse.ok) {
        return res.status(502).json({ message: "Failed to obtain GitHub token" });
      }

      const tokenJson = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
      };
      if (!tokenJson.access_token || tokenJson.error) {
        return res.status(401).json({ message: "GitHub OAuth failed" });
      }

      const accessToken = tokenJson.access_token;
      const commonHeaders = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "AnishLeet",
      };

      const profileResponse = await fetch("https://api.github.com/user", {
        headers: commonHeaders,
      });
      if (!profileResponse.ok) {
        return res.status(502).json({ message: "Failed to fetch GitHub profile" });
      }
      const profile = (await profileResponse.json()) as GitHubUserResponse;

      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: commonHeaders,
      });
      const emails = emailsResponse.ok
        ? ((await emailsResponse.json()) as GitHubEmailResponse[])
        : [];

      const primaryEmail =
        emails.find((email) => email.primary && email.verified)?.email ||
        emails.find((email) => email.verified)?.email ||
        null;

      const [firstName, ...restName] = (profile.name || "").trim().split(/\s+/);
      const lastName = restName.length > 0 ? restName.join(" ") : null;
      const userId = `github_${profile.id}`;

      await upsertUser({
        id: userId,
        email: primaryEmail,
        firstName: firstName || null,
        lastName,
        profileImageUrl: profile.avatar_url || null,
      });

      const sessionUser = {
        id: userId,
        username: profile.login,
        email: primaryEmail,
        profileImageUrl: profile.avatar_url,
      };

      delete req.session.oauthState;
      req.login(sessionUser, (error: any) => {
        if (error) {
          return res.status(500).json({ message: "Failed to create session" });
        }
        return res.redirect("/");
      });
    } catch (error) {
      console.error("GitHub callback error:", error);
      return res.status(500).json({ message: "GitHub login failed" });
    }
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.redirect("/login");
      });
    });
  });

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const sessionUser = req.user;
      const user = await authStorage.getUser(sessionUser.id);
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const username =
        sessionUser.username ||
        user.email?.split("@")[0] ||
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        "user";

      return res.json({
        ...user,
        username,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      return res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};
