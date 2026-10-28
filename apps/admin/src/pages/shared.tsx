import type { Credits } from '@postitup/shared';

/** "Free tier — only free models work" callout (Overview, AI usage). */
export function FreeTierWarning({
  credits,
  modelName,
}: {
  credits: Credits | null | undefined;
  modelName: string;
}) {
  const k = credits?.key;
  if (!k?.isFreeTier) return null;
  const left = k.freeRequests ? `${k.freeRequests.remaining} of ${k.freeRequests.limit}` : 'a few';
  return (
    <p className="callout" role="note">
      Free tier — only free models work ({left} free requests left today). Add credits on
      openrouter.ai to use {modelName}.
    </p>
  );
}
