"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, RefreshCw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DocumentCard } from "@/components/DocumentCard";
import { useDocuments } from "@/hooks/useDocuments";
import { AppHeader } from "@/components/layout";

interface ProfileData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { documents, loading, error, refresh, deleteDocument, updateDocumentMemory } = useDocuments();
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);

  // Check if profile is complete
  useEffect(() => {
    async function checkProfile() {
      try {
        const response = await fetch("/api/profile");
        if (response.ok) {
          const data = await response.json();
          const profile = data.coreData as ProfileData | null;
          // Consider profile complete if at least first name and last name are filled
          const isComplete = !!(profile?.firstName && profile?.lastName);
          setProfileComplete(isComplete);
        } else {
          setProfileComplete(false);
        }
      } catch {
        setProfileComplete(false);
      }
    }
    checkProfile();
  }, []);

  const handleUploadClick = () => {
    router.push("/document");
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDocument(id);
      toast.success("Document deleted");
    } catch {
      toast.error("Failed to delete document");
    }
  };

  const handleToggleMemory = async (id: string, useMemory: boolean) => {
    try {
      await updateDocumentMemory(id, useMemory);
      toast.success(useMemory ? "Memory enabled" : "Memory disabled");
    } catch {
      toast.error("Failed to update memory setting");
    }
  };

  return (
    <>
      <AppHeader>
        <div className="flex flex-1 items-center justify-between">
          <h1 className="text-lg font-semibold">Documents</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={handleUploadClick}>
              <Plus className="h-4 w-4 mr-2" />
              New Document
            </Button>
          </div>
        </div>
      </AppHeader>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-6">
          <p className="text-muted-foreground">
            Upload and manage your documents
          </p>

          {error && (
            <Card className="border-destructive">
              <CardContent className="p-4 text-destructive">{error}</CardContent>
            </Card>
          )}

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No documents yet</CardTitle>
                <CardDescription>
                  Upload your first document to get started. We&apos;ll analyze
                  it and help you fill it out with AI-powered suggestions.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  onDelete={handleDelete}
                  onToggleMemory={handleToggleMemory}
                />
              ))}
            </div>
          )}

          {/* Profile completion prompt */}
          {profileComplete === false && (
            <Card className="border-muted bg-muted/30">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Complete your profile</p>
                    <p className="text-sm text-muted-foreground">
                      Add your name and details to improve auto-fill accuracy
                    </p>
                  </div>
                </div>
                <Button variant="secondary" asChild>
                  <Link href="/profile">Complete profile</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
