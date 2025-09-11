import React, { useState } from "react";

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState("");

  const handleLogin = () => {
    if (!username) return alert("사용자 이름 입력 필요");
    onLogin(username);
  };

  return (
    <div>
      <input
        type="text"
        placeholder="사용자 이름"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <button onClick={handleLogin}>로그인</button>
    </div>
  );
};

export default Login;
