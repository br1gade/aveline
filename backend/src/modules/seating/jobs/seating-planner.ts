import { Injectable } from '@nestjs/common';
import { buildSeatingPlan, SeatingPlan } from '../seating-plan';
import { SeatingInput } from './seating-input';

/** The worker's computation boundary; never called by an HTTP controller. */
@Injectable()
export class SeatingPlanner {
  plan(input: SeatingInput): Promise<SeatingPlan> {
    return Promise.resolve(buildSeatingPlan(input.households, input.tables, input.availableSeats));
  }
}
