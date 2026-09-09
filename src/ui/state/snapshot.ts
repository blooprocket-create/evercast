import { snapshotStore } from '../../app/runtime';
import { createSnapshotHooks } from './useSnapshot';

export const { useSnapshot, useSnapshotSelector } = createSnapshotHooks(snapshotStore);
