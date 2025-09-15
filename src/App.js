// App.jsx
import React, { useState } from "react";
import Login from "../src/ui/Login";
import VideoChatRoom from "../src/ui/VideoChatRoom";

function App() {
  const [loggedIn, setLoggedIn] = useState(false);

  return (
    <>
      {loggedIn ? (
        <VideoChatRoom />
      ) : (
        <Login onLogin={() => setLoggedIn(true)} />
      )}
    </>
  );
}

export default App;
