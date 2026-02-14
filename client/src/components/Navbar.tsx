import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Code2, Trophy, User, LogOut, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function Navbar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isActive = (path: string) => location === path;

  return (
    <nav className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container h-full mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 font-display font-bold text-xl text-foreground hover:text-primary transition-colors">
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <Code2 className="w-6 h-6 text-primary" />
            </div>
            LeetClone
          </Link>

          <div className="hidden md:flex items-center gap-1">
            <Link href="/">
              <a className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isActive('/') ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}>
                Problems
              </a>
            </Link>
            <Link href="/contest">
              <a className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors opacity-50 cursor-not-allowed`}>
                Contest
              </a>
            </Link>
            <Link href="/discuss">
              <a className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors opacity-50 cursor-not-allowed`}>
                Discuss
              </a>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-accent/50 rounded-full border border-border">
                <Trophy className="w-4 h-4 text-yellow-500" />
                <span className="text-xs font-mono font-medium text-muted-foreground">0 Solved</span>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full ring-offset-background transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    <Avatar className="h-9 w-9 border border-border">
                      <AvatarImage src={user.profileImageUrl || undefined} alt={user.username} />
                      <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
                        {user.username.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 mt-2">
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium">{user.username}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer">
                    <Terminal className="mr-2 h-4 w-4" />
                    <span>My Submissions</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer text-red-500 focus:text-red-500" onClick={() => logout()}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" className="text-muted-foreground hover:text-foreground">Sign In</Button>
              </Link>
              <Link href="/login">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg shadow-primary/20">
                  Register
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
