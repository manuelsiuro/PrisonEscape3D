import { PickCard, DiceCard, WrestleCard } from '../ui/games';
import { BoardCard, CheatCard, CourtCard } from '../ui/pastimes';
import { RaceCard, RatRunCard } from '../ui/long';
import { InkCard, MatchCard } from '../ui/team';
import { StageCard } from '../ui/stage';
import { QuizCard } from '../ui/quiz';
import { click } from './context';
import { sendOp } from './game';
import { quizDone } from './nights';

/**
 * The side games' cards (P22, P27–P30) in a file of their own (v2.34.2, the faster first load):
 * fetched once the title is up, made then in this order (the order they stack), put where they were
 * made before (lazy.ts). The rest of the game reaches them through lazy.ts's gameCards().
 */
export function makeCards() {
  /** The side games (P22): the arm-wrestle's card and the lockpick's. */
  const wrestleCard = new WrestleCard(sendOp);
  const pickCard = new PickCard();
  /** 2.40: a game of dice on its own card. */
  const diceCard = new DiceCard(sendOp, click);
  /** Card sharks (P27): a hand of Cheat, the court's card, the old-timer's checkers board. */
  const cheatCard = new CheatCard(sendOp, click);
  const courtCard = new CourtCard();
  const boardCard = new BoardCard(sendOp, click);
  /** Long games (P28): the race card at the track. */
  const raceCard = new RaceCard(sendOp, click);
  /** 2.43: the rat's training, a timing game. */
  const ratCard = new RatRunCard(sendOp);
  /** Team & ink (P29): the match's card, the tattoo's. */
  const matchCard = new MatchCard();
  const inkCard = new InkCard(sendOp, click);
  /** Stage nights (P30): talent night's card, quiz night's. */
  const stageCard = new StageCard(sendOp, click);
  const quizCard = new QuizCard(sendOp, click);
  quizCard.onDone = quizDone;
  return { wrestleCard, pickCard, diceCard, cheatCard, courtCard, boardCard, raceCard, ratCard, matchCard, inkCard, stageCard, quizCard };
}
