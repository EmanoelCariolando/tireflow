import { EMPLOYEE_SESSION_TTL_MS } from './employeeSessionDuration.js';

export type MonthlyCommissionReportSessionStep =
  | 'awaiting_report_type'
  | 'awaiting_start_date'
  | 'awaiting_end_date'
  | 'awaiting_confirmation'
  | 'processing';

export interface MonthlyCommissionReportSession {
  userId: string;
  chatId: string;
  step: MonthlyCommissionReportSessionStep;
  startDate?: Date;
  endDate?: Date;
  updatedAt: number;
}

const sessions = new Map<string, MonthlyCommissionReportSession>();

function buildKey(userId: string, chatId: string): string {
  return `${chatId}:${userId}`;
}

function isExpired(session: MonthlyCommissionReportSession): boolean {
  return Date.now() - session.updatedAt > EMPLOYEE_SESSION_TTL_MS;
}

function cloneSession(session: MonthlyCommissionReportSession): MonthlyCommissionReportSession {
  return {
    ...session,
    startDate: session.startDate ? new Date(session.startDate) : undefined,
    endDate: session.endDate ? new Date(session.endDate) : undefined,
  };
}

export function saveMonthlyCommissionReportSession(
  session: MonthlyCommissionReportSession
): void {
  sessions.set(buildKey(session.userId, session.chatId), cloneSession({
    ...session,
    updatedAt: Date.now(),
  }));
}

export function getMonthlyCommissionReportSession(
  userId: string,
  chatId: string
): MonthlyCommissionReportSession | null {
  const sessionKey = buildKey(userId, chatId);
  const session = sessions.get(sessionKey);
  if (!session) return null;
  if (isExpired(session)) {
    sessions.delete(sessionKey);
    return null;
  }
  return cloneSession(session);
}

export function hasExpiredMonthlyCommissionReportSession(
  userId: string,
  chatId: string
): boolean {
  const sessionKey = buildKey(userId, chatId);
  const session = sessions.get(sessionKey);
  if (!session || !isExpired(session)) return false;
  sessions.delete(sessionKey);
  return true;
}

export function clearMonthlyCommissionReportSession(userId: string, chatId: string): void {
  sessions.delete(buildKey(userId, chatId));
}
