"use client";

import { useRouter } from "next/navigation";
import { FullCanvasDropZone } from "@/components/document/FullCanvasDropZone";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Save, Download, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/layout";

export default function NewDocumentPage() {
  const router = useRouter();

  const handleDocumentCreated = (documentId: string) => {
    router.push(`/document/${documentId}`);
  };

  return (
    <>
      <AppHeader>
        <div className="flex flex-1 items-center justify-between">
          <div>
            <h1 className="font-semibold">New Document</h1>
            <p className="text-sm text-muted-foreground">
              Upload a PDF to get started
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled>
              <Save className="mr-2 h-4 w-4" />
              Saved
            </Button>
            <Button disabled>
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>
      </AppHeader>
      <div className="px-4">
        <Progress value={0} className="h-2" />
      </div>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize={65} minSize={40}>
            <div className="h-full border-r">
              <FullCanvasDropZone onDocumentCreated={handleDocumentCreated} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={35} minSize={25}>
            <div className="flex flex-col h-full bg-card">
              <div className="px-4 py-3 border-b">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold">AI Assistant</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Upload a PDF to see AI-generated questions
                </p>
              </div>
              <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-muted-foreground">
                  <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p className="font-medium">No document loaded</p>
                  <p className="text-sm mt-1">
                    Upload a PDF to get started with AI-assisted form filling
                  </p>
                </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </>
  );
}
