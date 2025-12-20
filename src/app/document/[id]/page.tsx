import { DocumentPage } from "@/components/document";

export default async function DocumentPageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DocumentPage documentId={id} />;
}
