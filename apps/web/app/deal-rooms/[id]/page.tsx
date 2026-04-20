import { DealRoomClient } from '@/components/deal-room-client';

export default async function DealRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DealRoomClient dealRoomId={id} />;
}
