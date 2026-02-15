import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ProblemList from "@/pages/ProblemList";
import ProblemDetail from "@/pages/ProblemDetail";
import Login from "@/pages/Login";
import Profile from "@/pages/Profile";
import Submissions from "@/pages/Submissions";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ProblemList} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Login} />
      <Route path="/problems/:id" component={ProblemDetail} />
      <Route path="/profile" component={Profile} />
      <Route path="/submissions" component={Submissions} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
