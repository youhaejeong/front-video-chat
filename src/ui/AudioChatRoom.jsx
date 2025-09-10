import React, { useEffect, useState, useRef, useCallback } from "react";
import { useWebRTC } from "../hooks/useWebRTC";

const AudioChatRoom = ({ roomId, userId }) => {
  const turnConfig = {
    urls: "turn:localhost:3478",
    username: "user",
    credential: "pass"
  };

  const { localAudioRef, remoteStreams, createOffer: originalCreateOffer } = useWebRTC(roomId, userId, turnConfig);

  const [isPlaying, setIsPlaying] = useState(false);     // 재생 상태 표시
  const [isSpeaking, setIsSpeaking] = useState(false);   // 말하고 있는지 상태
  const remoteAudioRefs = useRef({});                    // 원격 오디오 refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);

  // createOffer를 useCallback으로 감싸 ESLint 경고 제거
  const createOffer = useCallback(() => {
    originalCreateOffer();
  }, [originalCreateOffer]);

  // 방 입장 시 offer 생성
  useEffect(() => {
    createOffer();
  }, [createOffer]);

  // 로컬 오디오 재생 상태 감지
  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  // 내 목소리 감지
  useEffect(() => {
    if (!localAudioRef.current || !localAudioRef.current.srcObject) return;

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    const source = audioContext.createMediaStreamSource(localAudioRef.current.srcObject);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    dataArrayRef.current = dataArray;

    const checkSpeaking = () => {
      analyser.getByteTimeDomainData(dataArray);
      const avg = dataArray.reduce((a, b) => a + Math.abs(b - 128), 0) / dataArray.length;
      setIsSpeaking(avg > 5);
      requestAnimationFrame(checkSpeaking);
    };

    checkSpeaking();
  }, []); // localAudioRef.current는 mutable ref이므로 dependency에 넣지 않음

  return (
    <div>
      <h2>움파 둠파 둠파디 두 🎤</h2>

      {/* 로컬 오디오 */}
      <audio
        ref={localAudioRef}
        autoPlay
        onPlay={handlePlay}
        onPause={handlePause}
      />

      {/* 재생 상태 표시 */}
      {isPlaying && (
        <div style={{ marginTop: "10px", color: "green", fontWeight: "bold" }}>
          🎧 음성 채팅 중
        </div>
      )}

      {/* 말하고 있는지 표시 */}
      {isSpeaking && (
        <div style={{ marginTop: "5px", color: "blue", fontWeight: "bold" }}>
          💬 말하는 중
        </div>
      )}

      {/* 원격 오디오 */}
      {remoteStreams.map((stream, idx) => {
        if (!remoteAudioRefs.current[idx]) {
          remoteAudioRefs.current[idx] = React.createRef();
        }
        return (
          <audio
            key={idx}
            ref={remoteAudioRefs.current[idx]}
            autoPlay
            onLoadedMetadata={() => {
              if (remoteAudioRefs.current[idx].current) {
                remoteAudioRefs.current[idx].current.srcObject = stream;
              }
            }}
          />
        );
      })}
    </div>
  );
};

export default AudioChatRoom;
