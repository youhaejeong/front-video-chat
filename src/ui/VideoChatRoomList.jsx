import React, { useEffect, useState } from "react";
import axios from "axios";
import VideoChatRoom from "./VideoChatRoom";

const VideoChatRoomList = () => {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);

  const username = localStorage.getItem("username");

  const fetchRooms = async () => {
    const res = await axios.get("http://localhost:8080/room/list");
    setRooms(res.data || []);
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const handleCreateRoom = async () => {
    const roomId = `room-${Date.now()}`;
    const res = await axios.post("http://localhost:8080/room/create", {
      username,
      roomId,
    });

    console.log(res.data.message);

    //role과 roomId를 localStorage에 업데이트
    localStorage.setItem("role", "ROLE_BROADCASTER");
    localStorage.setItem("roomId", roomId);

    setSelectedRoom(roomId);
  };

  const handleJoinRoom = async (roomId) => {
    await axios.post("http://localhost:8080/room/join", { username, roomId });

    // role과 roomId 업데이트
    localStorage.setItem("role", "ROLE_VIEWER");
    localStorage.setItem("roomId", roomId);

    setSelectedRoom(roomId);
  };

  if (selectedRoom)
    return <VideoChatRoom roomId={selectedRoom} username={username} />;

  return (
    <div style={{ padding: "20px" }}>
      <h2>방 목록</h2>
      <button onClick={handleCreateRoom} style={{ marginBottom: "10px" }}>
        방 생성
      </button>
      <ul>
        {rooms.map((roomId) => (
          <li key={roomId} style={{ margin: "5px 0" }}>
            {roomId}{" "}
            <button onClick={() => handleJoinRoom(roomId)}>입장</button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default VideoChatRoomList;
