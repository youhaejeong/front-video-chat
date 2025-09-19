// App.jsx
import React, { useState } from "react";
import Login from "../src/ui/Login";
import VideoChatRoomList from "../src/ui/VideoChatRoomList";
import VideoChatRoom from "../src/ui/VideoChatRoom";

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  if (!selectedRoom) {
    return <VideoChatRoomList onEnterRoom={setSelectedRoom} />;
  }

  return <VideoChatRoom roomId={selectedRoom} />;
}

export default App;
