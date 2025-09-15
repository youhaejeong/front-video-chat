import React, { useState } from "react";
import axios from "axios";

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("default-room"); // 기본 룸 ID

  const handleLogin = async () => {
    if (!username) return alert("사용자 이름 입력 필요");

    try {
      const res = await axios.post("http://localhost:8080/auth/login", {
        username,
        roomId,
        password: "123", // 고정
      });

      localStorage.setItem("username", username);
      localStorage.setItem("roomId", roomId);
      localStorage.setItem("accessToken", res.data.accessToken);
      localStorage.setItem("refreshToken", res.data.refreshToken);
      console.log(res.data.role)
      localStorage.setItem("role", res.data.role);

      onLogin(); // 부모 컴포넌트 상태 변경
    } catch (err) {
      console.error("로그인 실패:", err);
      
    }
  };

  return (
    <div style={{ maxWidth: "400px", margin: "0 auto" }}>
      <h2>로그인</h2>
      <input
        type="text"
        placeholder="사용자 이름"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <br />
      <button onClick={handleLogin}>로그인</button>
    </div>
  );
};

export default Login;
