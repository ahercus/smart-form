import { Skeleton } from "@/components/ui/skeleton";

export default function DocumentPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <p className="text-sm text-muted-foreground text-center">
          Document ID: {params.id}
        </p>
      </div>
    </div>
  );
}
