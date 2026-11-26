import { z } from 'zod';
export const ticketPolicySchema = z.object({
  firstReplyHours: z.number().int().min(1).max(8760).default(24),
  firstReminderHours: z.number().int().min(1).max(8760).default(24),
  escalationHours: z.number().int().min(1).max(8760).default(48),
  userReminderHours: z.number().int().min(1).max(8760).default(72),
  userCloseHours: z.number().int().min(1).max(8760).default(168),
  activeReminderHours: z.number().int().min(1).max(8760).default(72),
  internalReminderHours: z.number().int().min(1).max(8760).default(72),
  retentionDays: z.number().int().min(1).max(3650).default(180),
  fileMaxMB: z.number().int().min(1).max(100).default(25),
  ticketMaxMB: z.number().int().min(1).max(1000).default(100),
}).refine(v => v.escalationHours >= v.firstReminderHours && v.userCloseHours > v.userReminderHours && v.ticketMaxMB >= v.fileMaxMB, '確認通知は終了より前、保存合計は1ファイル以上にしてください。');
export type TicketPolicy = z.infer<typeof ticketPolicySchema>;
export const DEFAULT_TICKET_POLICY = ticketPolicySchema.parse({});
export const TICKET_POLICY_LABELS: Record<keyof TicketPolicy, string> = {
  firstReplyHours:'初回返信の目安（時間）', firstReminderHours:'初回返信の確認通知（時間）', escalationHours:'宮司・神職への通知（時間）',
  userReminderHours:'相談者への返信確認（時間）', userCloseHours:'返信なし自動終了（時間）', activeReminderHours:'対応中の進捗確認（時間）',
  internalReminderHours:'運営内確認の進捗確認（時間）', retentionDays:'完了後の保存（日）', fileMaxMB:'1ファイル保存上限（MB）', ticketMaxMB:'添付保存合計（MB）',
};
export const TICKET_STATE_LABELS = { unassigned:'未対応', active:'対応中', user_wait:'相談者の返信待ち', internal_wait:'運営内の確認待ち', closed:'完了' } as const;
export type TicketWorkflowState = keyof typeof TICKET_STATE_LABELS;
export function effectiveTicketPolicy(common?: Partial<TicketPolicy>, override?: Partial<TicketPolicy>): TicketPolicy {
  return ticketPolicySchema.parse({ ...DEFAULT_TICKET_POLICY, ...common, ...override });
}
