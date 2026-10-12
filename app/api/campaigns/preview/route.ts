import { createPreviewToken } from '@/lib/core/preview-token';
import { NextRequest, NextResponse } from 'next/server';
import { jsonBody, jsonError, requireUserContext } from '@/lib/core/http';
import { parseCampaignInput, prepareCampaign } from '@/lib/core/campaigns';

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserContext();
    const input = parseCampaignInput(await jsonBody(request));
    const prepared = await prepareCampaign(user, input);
    return NextResponse.json({ previewToken: createPreviewToken(user.id, input, prepared), senderAddress: prepared.senderAddress, resume: { id: input.resumeId.toHexString(), label: prepared.resume.label, size: prepared.resume.size }, previews: prepared.previews, skipped: prepared.skipped });
  } catch (error) { return jsonError(error); }
}
