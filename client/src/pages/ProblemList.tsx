import { useProblems } from "@/hooks/use-problems";
import { Link } from "wouter";
import { Navbar } from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const DIFFICULTY_COLORS = {
  Easy: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  Medium: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
  Hard: "text-red-500 bg-red-500/10 border-red-500/20",
};

export default function ProblemList() {
  const { data: problems, isLoading } = useProblems();

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Navbar />

      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <h1 className="text-3xl font-bold font-display mb-2">Problems</h1>
              <p className="text-muted-foreground">
                Sharpen your coding skills with our collection of algorithm challenges.
              </p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="w-[50px]">Status</TableHead>
                    <TableHead className="w-[400px]">Title</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i} className="border-border">
                        <TableCell><Skeleton className="h-5 w-5 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-9 w-24 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : problems?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        No problems found. Check back later!
                      </TableCell>
                    </TableRow>
                  ) : (
                    problems?.map((problem) => (
                      <TableRow key={problem.id} className="group border-border hover:bg-accent/30 transition-colors">
                        <TableCell>
                          <Circle className="w-5 h-5 text-muted-foreground/30" />
                        </TableCell>
                        <TableCell>
                          <Link href={`/problems/${problem.id}`}>
                            <a className="font-medium text-foreground group-hover:text-primary transition-colors block py-2">
                              {problem.order}. {problem.title}
                            </a>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={cn("font-medium border", DIFFICULTY_COLORS[problem.difficulty as keyof typeof DIFFICULTY_COLORS])}
                          >
                            {problem.difficulty}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {problem.category}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/problems/${problem.id}`}>
                            <Button variant="secondary" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                              Solve
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-full md:w-80 flex-shrink-0 space-y-6">
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="font-display font-bold text-lg mb-4">Daily Challenge</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Today's Solvers</span>
                  <span className="font-mono">1,234</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-[65%] bg-gradient-to-r from-primary to-primary/60 rounded-full" />
                </div>
                <Button className="w-full" variant="outline">View Challenge</Button>
              </div>
            </div>

            <div className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-xl border border-primary/20 p-6">
              <h3 className="font-display font-bold text-lg mb-2 text-primary">Pro Features</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Unlock detailed solutions, company tags, and more.
              </p>
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                Go Premium
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
