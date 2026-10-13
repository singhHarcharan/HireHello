type CampaignState = { id: string; name: string; status: string; totals?: Record<string, number>; queueDispatchStatus?: string };
export type CampaignNotice = { id: string; tone: 'success' | 'error' | 'info'; message: string };

/** Compare observed snapshots: unchanged polling and initial history stay quiet. */
export function campaignNotifications(previous: CampaignState[] | null, current: CampaignState[]): CampaignNotice[] {
  if (previous === null) return [];
  const old = new Map(previous.map(c => [c.id, c]));
  return current.flatMap<CampaignNotice>(c => {
    const before = old.get(c.id);
    if (!before) return [{ id: `campaign-${c.id}`, tone: "info", message: `${c.name}: campaign ${c.status}. Open Campaigns for its results.` }];
    const accepted = c.totals?.accepted || 0;
    const failed = c.totals?.failed || 0;
    const uncertain = c.totals?.uncertain || 0;
    const id = `campaign-${c.id}`;
    if (c.status === 'completed' && before.status !== 'completed') return [{ id, tone: failed || uncertain ? 'error' as const : 'success' as const, message: `${c.name}: finished. ${accepted} accepted by Gmail, ${failed} failed${uncertain ? `, ${uncertain} need review` : ''}.` }];
    if (c.status === 'paused' && before.status !== 'paused') return [{ id, tone: 'info' as const, message: `${c.name}: sending paused. Check campaign details before resuming.` }];
    if (failed > (before.totals?.failed || 0) || uncertain > (before.totals?.uncertain || 0)) return [{ id, tone: 'error' as const, message: `${c.name}: ${failed} failed, ${uncertain} need review. Open campaign results.` }];
    if (accepted > (before.totals?.accepted || 0)) return [{ id, tone: 'success' as const, message: `${c.name}: ${accepted} email${accepted === 1 ? '' : 's'} accepted by Gmail. ${c.totals?.queued || 0} remaining.` }];
    if (c.queueDispatchStatus === 'pending' && before.queueDispatchStatus !== 'pending') return [{ id, tone: 'error' as const, message: `${c.name}: scheduling needs attention. Open the campaign to restart sending.` }];
    if (c.status === 'queued' && before.status === 'paused') return [{ id, tone: 'info' as const, message: `${c.name}: sending resumed.` }];
    return [];
  });
}
