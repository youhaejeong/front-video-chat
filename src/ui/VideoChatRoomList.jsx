import React, { useEffect, useState, useRef } from "react";
import mqtt from "mqtt";
import VideoChatRoom from "./VideoChatRoom";

const VideoChatRoomList = () => {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);

  const username = localStorage.getItem("username");
  const mqttClientRef = useRef(null);

  // MQTT 연결
  useEffect(() => {
    const client = mqtt.connect("ws://localhost:9001", {
      clientId: username + "_" + Date.now(),
      reconnectPeriod: 1000,
    });

    mqttClientRef.current = client;

    client.on("connect", () => {
      console.log("MQTT connected for room list");

      // 방 생성/삭제 이벤트 구독
      client.subscribe("room/create");
      client.subscribe("room/delete");
    });

    client.on("message", (topic, message) => {
      const roomId = message.toString();

      if (topic === "room/create") {
        setRooms((prev) => (prev.includes(roomId) ? prev : [...prev, roomId]));
      }

      if (topic === "room/delete") {
        setRooms((prev) => prev.filter((r) => r !== roomId));
      }
    });

    return () => {
      client.end(true);
    };
  }, [username]);

  // 방 생성
  const handleCreateRoom = () => {
    const roomId = `room-${Date.now()}`;

    localStorage.setItem("role", "ROLE_BROADCASTER");
    localStorage.setItem("roomId", roomId);
    setSelectedRoom(roomId);

    // MQTT로 방 생성 알림
    if (mqttClientRef.current?.connected) {
      mqttClientRef.current.publish("room/create", roomId);
    }
  };

  // 방 입장
  const handleJoinRoom = (roomId) => {
    localStorage.setItem("role", "ROLE_VIEWER");
    localStorage.setItem("roomId", roomId);
    setSelectedRoom(roomId);
  };

  if (selectedRoom) {
    return (
      <VideoChatRoom
        setSelectedRoom={setSelectedRoom}
        mqttClient={mqttClientRef.current} // VideoChatRoom에서 사용
      />
    );
  }

  return (
    <div style={{ padding: "20px" }}>
      <h2>방 목록</h2>
      <button onClick={handleCreateRoom} style={{ marginBottom: "10px" }}>
        방 생성
      </button>
      <ul>
        {rooms.map((roomId) => (
          <li key={roomId} style={{ margin: "5px 0" }}>
            {roomId}
            <button onClick={() => handleJoinRoom(roomId)}>입장</button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default VideoChatRoomList;
