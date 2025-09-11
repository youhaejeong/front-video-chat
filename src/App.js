import React, { useState } from "react";
import Login from "./ui/Login";
import VideoChatRoom from "./ui/VideoChatRoom";

function App() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("room1"); // 기본 룸

  return (
    <div>
      {!username ? (
        <Login onLogin={setUsername} />
      ) : (
        <VideoChatRoom roomId={roomId} username={username} />
      )}
    </div>
  );
}

export default App;
