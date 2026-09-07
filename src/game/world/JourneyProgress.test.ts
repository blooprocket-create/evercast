import { describe, expect, it } from 'vitest';
import { earnedJourneyStages } from './JourneyProgress';

describe('journey world progression', () => {
  it('does not move the world forward while farming', () => {
    expect(earnedJourneyStages({ mode: 'farm', frontierStage: 10, visualFrontierStage: 10 })).toBe(0);
  });

  it('does not move the world forward when retrying the same unbeaten frontier', () => {
    expect(earnedJourneyStages({ mode: 'push', frontierStage: 10, visualFrontierStage: 10 })).toBe(0);
  });

  it('moves exactly when a new frontier stage is earned', () => {
    expect(earnedJourneyStages({ mode: 'push', frontierStage: 11, visualFrontierStage: 10 })).toBe(1);
    expect(earnedJourneyStages({ mode: 'push', frontierStage: 15, visualFrontierStage: 11 })).toBe(4);
  });
});
