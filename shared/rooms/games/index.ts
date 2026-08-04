/**
 * Every game the room can run.
 *
 * One registry, imported by the Worker and by the in-process test room. It used
 * to be written out in both, which meant adding a game silently left the tests
 * covering three while the server served four.
 */
import type { Game, Snapshot } from '../protocol';
import type { ApplyAction } from '../roomCore';
import type { IdSource } from '../../ids';
import { cricketApply, cricketInitialState } from './cricket';
import { scrabbleApply, scrabbleInitialState } from './scrabble';
import { rummikubApply, rummikubInitialState } from './rummikub';

export interface GameSetup {
  initial: () => Snapshot;
  apply: (uid: IdSource) => ApplyAction<Snapshot>;
}

export const GAME_SETUP: Record<Game, GameSetup> = {
  cricket: { initial: cricketInitialState, apply: cricketApply },
  scrabble: { initial: scrabbleInitialState, apply: scrabbleApply },
  rummikub: { initial: rummikubInitialState, apply: rummikubApply },
};
