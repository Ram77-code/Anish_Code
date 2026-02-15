import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";

// GET /api/problems
export function useProblems() {
  return useQuery({
    queryKey: [api.problems.list.path],
    queryFn: async () => {
      const res = await fetch(api.problems.list.path);
      if (!res.ok) throw new Error("Failed to fetch problems");
      return api.problems.list.responses[200].parse(await res.json());
    },
  });
}

// GET /api/problems/:id
export function useProblem(id: number) {
  return useQuery({
    queryKey: [api.problems.get.path, id],
    enabled: !!id,
    queryFn: async () => {
      const url = buildUrl(api.problems.get.path, { id });
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch problem");
      return api.problems.get.responses[200].parse(await res.json());
    },
  });
}

// POST /api/submissions
export function useSubmitSolution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      code: string;
      problemId: number;
      language: "javascript" | "python";
    }) => {
      const res = await apiRequest("POST", api.submissions.create.path, data);
      return api.submissions.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      // Invalidate submissions list
      queryClient.invalidateQueries({ queryKey: [api.submissions.list.path] });
    },
  });
}

// POST /api/submissions/run
export function useRunCode() {
  return useMutation({
    mutationFn: async (data: {
      code: string;
      problemId: number;
      language: "javascript" | "python";
    }) => {
      const res = await apiRequest("POST", api.submissions.run.path, data);
      return api.submissions.run.responses[200].parse(await res.json());
    },
  });
}

// GET /api/submissions
export function useSubmissions() {
  return useQuery({
    queryKey: [api.submissions.list.path],
    queryFn: async () => {
      const res = await fetch(api.submissions.list.path, { credentials: "include" });
      if (res.status === 401) return null; // Not logged in
      if (!res.ok) throw new Error("Failed to fetch submissions");
      return api.submissions.list.responses[200].parse(await res.json());
    },
  });
}
