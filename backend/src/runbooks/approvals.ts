import { UserRole } from '../types/incidents.js';
import { logger } from '../utils/logger.js';

export class UnauthorizedApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedApprovalError';
  }
}

export interface DualCustodyValidationResult {
  approved: boolean;
  reason?: string;
}

export class DualCustodyApprovalGate {
  /**
   * Validate dual-custody authorization rules:
   * 1. Approver MUST NOT be the same user who requested the execution (Separation of Duties).
   * 2. Approver MUST hold either INCIDENT_COMMANDER or ADMIN role.
   */
  validateApproval(params: {
    requesterId: string;
    approverId: string;
    approverRole: UserRole;
    runbookRequiresApproval: boolean;
  }): DualCustodyValidationResult {
    if (!params.runbookRequiresApproval) {
      return { approved: true };
    }

    // Rule 1: Separation of duties
    if (params.requesterId === params.approverId) {
      logger.warn(
        { requesterId: params.requesterId, approverId: params.approverId },
        'Dual-custody approval rejected: Requester cannot approve their own runbook'
      );
      throw new UnauthorizedApprovalError(
        'Dual-custody violation: The requester cannot approve their own execution request'
      );
    }

    // Rule 2: Minimum role requirement
    const allowedRoles: UserRole[] = ['ADMIN', 'INCIDENT_COMMANDER'];
    if (!allowedRoles.includes(params.approverRole)) {
      logger.warn(
        { approverId: params.approverId, approverRole: params.approverRole },
        'Dual-custody approval rejected: Insufficient role permissions'
      );
      throw new UnauthorizedApprovalError(
        `Insufficient role: User role '${params.approverRole}' cannot authorize high-impact runbooks`
      );
    }

    logger.info(
      { requesterId: params.requesterId, approverId: params.approverId },
      'Dual-custody authorization granted'
    );

    return { approved: true };
  }
}
