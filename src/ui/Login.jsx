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

      const userData = {
        username,
        roomId,
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken,
        role: res.data.role,
      };

      // localStorage 저장
      Object.entries(userData).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });

      onLogin(userData); // 부모로 로그인 성공 데이터 전달
    } catch (err) {
      console.error("로그인 실패:", err);
      alert("로그인 실패. 서버를 확인하세요.");
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
