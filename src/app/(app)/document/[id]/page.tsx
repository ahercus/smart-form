import { DocumentPageContent } from "@/components/document/DocumentPageContent";

export default async function DocumentPageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DocumentPageContent documentId={id} />;
}
