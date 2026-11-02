import { Test } from '@nestjs/testing';
import { SalesPrivacySweepService } from './sales-privacy-sweep.service';
import { JobLockService } from './job-lock.service';
import { EnquiryPrivacyService } from '../../modules/sales/enquiry-privacy.service';
import { EnquiryRetentionService } from '../../modules/sales/enquiry-retention.service';
import { OwnerInviteDeliveryService } from '../../modules/sales/owner-invite-delivery.service';

describe('privacy recovery without Redis correctness', () => {
  it('runs due cleanup, protected checkpoint and finalize while Redis locking is unavailable', async () => {
    const locks = { runExclusively: jest.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const privacy = { checkpoint: jest.fn().mockResolvedValue(1), finalizeCheckpointedRequests: jest.fn().mockResolvedValue(1) };
    const retention = { sweep: jest.fn().mockResolvedValue({ cleared: 1, overdue: 0, uncheckpointed: 0 }) };
    const deliveries = { repair: jest.fn().mockResolvedValue(0) };
    const module = await Test.createTestingModule({ providers: [SalesPrivacySweepService,
      { provide: JobLockService, useValue: locks }, { provide: EnquiryPrivacyService, useValue: privacy },
      { provide: EnquiryRetentionService, useValue: retention }, { provide: OwnerInviteDeliveryService, useValue: deliveries },
    ] }).compile();
    await expect(module.get(SalesPrivacySweepService).recover()).resolves.toBeUndefined();
    expect(retention.sweep).toHaveBeenCalledTimes(1);
    expect(privacy.checkpoint).toHaveBeenCalledTimes(1);
    expect(privacy.finalizeCheckpointedRequests).toHaveBeenCalledTimes(1);
    expect(locks.runExclusively).not.toHaveBeenCalled();
    await module.close();
  });
});
