// App.js
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import AudioChatRoom from "./ui/AudioChatRoom";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route
          path="/AudioChatRoom"
          element={<AudioChatRoom roomId="room1" userId="user123" />}
        />
      </Routes>
    </Router>
  );
}
