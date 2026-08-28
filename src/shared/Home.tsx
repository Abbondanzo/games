import { Link } from 'react-router-dom';
import { Blocks, DoorOpen, Dices, SpellCheck, Target, type LucideIcon } from 'lucide-react';

interface Game {
  path?: string;
  Icon: LucideIcon;
  title: string;
  desc: string;
}

const GAMES: Game[] = [
  {
    path: '/scrabble',
    Icon: SpellCheck,
    title: 'Scrabble',
    desc: 'Word scoring with letter & word bonuses, bingos, and a dictionary lookup.',
  },
  {
    path: '/cricket',
    Icon: Target,
    title: 'Cricket (darts)',
    desc: 'Marks, closing out and points. Standard, cut-throat, or no points at all.',
  },
  {
    path: '/rummikub',
    Icon: Blocks,
    title: 'Rummikub',
    desc: 'Round-by-round scoring from the tiles left on each rack.',
  },
  {
    path: '/yahtzee',
    Icon: Dices,
    title: 'Yahtzee',
    desc: 'The paper score sheet, with every box a tap and the totals added up for you.',
  },
];

export function Home() {
  return (
    <main className="home">
      <h1>Games</h1>
      <p className="sub">Score trackers that run entirely in your browser.</p>
      <ul className="game-list">
        {GAMES.map((game) => (
          <li key={game.title}>
            {game.path ? (
              <Link className="game" to={game.path}>
                <GameBody game={game} />
              </Link>
            ) : (
              <div className="game soon">
                <GameBody game={game} />
                <span className="badge">planned</span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Link className="game join-row" to="/join">
        <DoorOpen className="icon" size={26} strokeWidth={1.75} aria-hidden="true" />
        <span>
          <span className="title">Join a game</span>
          <span className="desc">
            Someone else is keeping score. Enter their code to follow along.
          </span>
        </span>
      </Link>
    </main>
  );
}

const GameBody = ({ game }: { game: Game }) => (
  <>
    <game.Icon className="icon" size={26} strokeWidth={1.75} aria-hidden="true" />
    <span>
      <span className="title">{game.title}</span>
      <span className="desc">{game.desc}</span>
    </span>
  </>
);
