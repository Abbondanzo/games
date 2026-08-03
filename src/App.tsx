import { Navigate, Route, Routes } from 'react-router-dom';
import { Home } from './shared/Home';
import { ScrabbleTracker } from './scrabble/ScrabbleTracker';
import { CricketTracker } from './cricket/CricketTracker';
import { RummikubTracker } from './rummikub/RummikubTracker';
import { JoinRoom } from './rooms/JoinRoom';
import { UpdatePrompt } from './shared/UpdatePrompt';

export function App() {
  return (
    <>
      <UpdatePrompt />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/scrabble" element={<ScrabbleTracker />} />
        <Route path="/cricket" element={<CricketTracker />} />
        <Route path="/rummikub" element={<RummikubTracker />} />
        <Route path="/join" element={<JoinRoom />} />
        <Route path="/join/:code" element={<JoinRoom />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
