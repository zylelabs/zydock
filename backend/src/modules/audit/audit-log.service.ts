import auditLogModel from './audit-log.model';
import type { AuditLogAction } from './audit-log.schema';

type AuditLogParams = {
  organizationId: string;
  userId: string;
  serverId: string;
  action: AuditLogAction;
  containerId?: string;
  volume?: string;
  path?: string;
};

export const startAuditLog = (params: AuditLogParams) =>
  auditLogModel.create({ ...params, startedAt: new Date() });

export const endAuditLog = (auditLogId: string) =>
  auditLogModel.updateOne({ _id: auditLogId }, { $set: { endedAt: new Date() } });

export const recordAuditLog = (params: AuditLogParams) => {
  const now = new Date();

  return auditLogModel.create({ ...params, startedAt: now, endedAt: now });
};

export const serializeAuditLog = (log: AuditLog) => ({
  id: String(log._id),
  organizationId: String(log.organizationId),
  userId: String(log.userId),
  serverId: String(log.serverId),
  action: log.action,
  containerId: log.containerId,
  volume: log.volume,
  path: log.path,
  startedAt: log.startedAt,
  endedAt: log.endedAt,
  createdAt: log.createdAt,
});
