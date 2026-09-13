import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export type MonthlyInventoryReportSessionStep =
  | 'awaiting_report_type'
  | 'awaiting_start_date'
  | 'awaiting_end_date'
  | 'awaiting_confirmation'
  | 'processing';

export interface MonthlyInventoryReportSession {
  userId: string;
  chatId: string;
  step: MonthlyInventoryReportSessionStep;
  startDate?: Date;
  endDate?: Date;
  updatedAt: number;
}

const sessions = new Map<string, MonthlyInventoryReportSession>();

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: MonthlyInventoryReportSession): boolean {
  return Date.now() - session.updatedAt > EMPLOYEE_SESSION_TTL_MS;
}

function cloneSession(session: MonthlyInventoryReportSession): MonthlyInventoryReportSession {
  return {
    ...session,
    startDate: session.startDate ? new Date(session.startDate) : undefined,
    endDate: session.endDate ? new Date(session.endDate) : undefined,
  };
}

export function saveMonthlyInventoryReportSession(
  session: MonthlyInventoryReportSession
): void {
  sessions.set(buildKey(session.userId, session.chatId), cloneSession({
    ...session,
    updatedAt: Date.now(),
  }));
}

export function getMonthlyInventoryReportSession(
  userId: string,
  chatId: string
): MonthlyInventoryReportSession | null {
  const sessionKey = buildKey(userId, chatId);
  const session = sessions.get(sessionKey);
  if (!session) return null;
  if (isExpired(session)) {
    sessions.delete(sessionKey);
    return null;
  }
  return cloneSession(session);
}

export function hasExpiredMonthlyInventoryReportSession(
  userId: string,
  chatId: string
): boolean {
  const sessionKey = buildKey(userId, chatId);
  const session = sessions.get(sessionKey);
  if (!session || !isExpired(session)) return false;
  sessions.delete(sessionKey);
  return true;
}

export function clearMonthlyInventoryReportSession(userId: string, chatId: string): void {
  sessions.delete(buildKey(userId, chatId));
}
