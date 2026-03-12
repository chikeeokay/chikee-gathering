import React, { useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Calendar as CalendarIcon, PartyPopper, LogIn } from "lucide-react";
import { format } from "date-fns";
import { AuthContext } from "../App";
import { db, signInWithGoogle } from "../firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { handleFirestoreError, OperationType } from "../lib/errorHandling";

export default function CreateSessionPage() {
  const navigate = useNavigate();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { user, loading } = useContext(AuthContext);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        alert("登入視窗被瀏覽器封鎖了，請允許彈出視窗後再試一次。");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore
      } else {
        console.error("Login error:", error);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };
  const [eventType, setEventType] = useState<"boardgame" | "mahjong" | "social">("boardgame");
  const [hostName, setHostName] = useState("");
  const [hostWhatsapp, setHostWhatsapp] = useState("");
  const [gameName, setGameName] = useState("");
  const [location, setLocation] = useState("");
  const [rules, setRules] = useState("");
  const [purpose, setPurpose] = useState("");
  const [content, setContent] = useState("");
  const [playerCount, setPlayerCount] = useState("3-4");
  const [minPlayers, setMinPlayers] = useState("3");
  const [maxPlayers, setMaxPlayers] = useState("4");
  const [dateOptions, setDateOptions] = useState<{date: string, startTime: string, endTime: string}[]>([{ date: "", startTime: "19:00", endTime: "23:00" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdSession, setCreatedSession] = useState<{ id: string; booking_code: string } | null>(null);

  const handleAddDate = () => {
    setDateOptions([...dateOptions, { date: "", startTime: "19:00", endTime: "23:00" }]);
  };

  const handleRemoveDate = (index: number) => {
    const newOptions = [...dateOptions];
    newOptions.splice(index, 1);
    setDateOptions(newOptions);
  };

  const handleDateChange = (index: number, field: 'date' | 'startTime' | 'endTime', value: string) => {
    const newOptions = [...dateOptions];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setDateOptions(newOptions);
  };

  const handleEventTypeChange = (type: "boardgame" | "mahjong" | "social") => {
    setEventType(type);
    if (type === "mahjong") {
      setGameName("港式台牌");
    } else if (type === "social") {
      setGameName("交友聚會");
    } else {
      setGameName("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      alert("請先登入");
      return;
    }

    // Filter out empty dates
    const validDates = dateOptions
      .filter((d) => d.date.trim() !== "")
      .map((d) => `${d.date}T${d.startTime}~${d.endTime}`);

    const now = new Date();
    for (const d of validDates) {
      const [datePart, timePart] = d.split('T');
      const [start] = timePart.split('~');
      const startTimeStr = `${datePart}T${start}:00`;
      if (new Date(startTimeStr) < now) {
        alert("提議的日期與時間不能早過當天。");
        return;
      }
    }

    const finalPlayerCount = eventType === "mahjong" ? "4" : playerCount;
    const finalMinPlayers = eventType === "mahjong" ? 4 : parseInt(minPlayers, 10);
    const finalMaxPlayers = eventType === "mahjong" ? 4 : parseInt(maxPlayers, 10);

    if (!hostName || !hostWhatsapp || !gameName || !finalPlayerCount || validDates.length === 0 || (eventType === "social" && !content)) {
      alert("請填寫所有必填欄位並提供至少一個日期。");
      return;
    }

    setIsSubmitting(true);
    try {
      const bookingCode = Math.floor(1000 + Math.random() * 9000).toString();
      
      const sessionData: any = {
        host_uid: user.uid,
        host_name: hostName,
        host_whatsapp: hostWhatsapp,
        game_name: gameName,
        event_type: eventType,
        player_count_preference: finalPlayerCount,
        dates_available: validDates,
        game_source: "N/A",
        location: location,
        min_players: finalMinPlayers,
        max_players: finalMaxPlayers,
        booking_code: bookingCode,
        created_at: new Date().toISOString()
      };

      if (eventType === "mahjong") sessionData.rules = rules;
      if (eventType === "social") {
        sessionData.purpose = purpose;
        sessionData.content = content;
      }

      const docRef = await addDoc(collection(db, "sessions"), sessionData);
      
      // Save host token in localStorage (optional now that we have Auth, but keeps compatibility)
      localStorage.setItem(`host_${docRef.id}`, 'true');
      
      setCreatedSession({ id: docRef.id, booking_code: bookingCode });
      setIsSubmitting(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "sessions");
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 font-bold text-xl">載入中...</div>;
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="brutal-card p-8 text-center bg-white">
          <PartyPopper className="w-16 h-16 mx-auto mb-4 text-orange-500" />
          <h2 className="text-3xl font-black mb-4">建立約局</h2>
          <p className="text-stone-600 font-bold mb-8">請先使用 Google 帳號登入，才能建立約局。</p>
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className={`brutal-btn bg-orange-400 hover:bg-orange-500 text-black px-6 py-3 text-lg inline-flex items-center gap-2 ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <LogIn className="w-5 h-5" />
            {isLoggingIn ? '登入中...' : 'Google 登入'}
          </button>
        </div>
      </div>
    );
  }

  if (createdSession) {
    return (
      <div className="max-w-2xl mx-auto pb-12">
        <div className="bg-white border-4 border-black p-8 rounded-2xl shadow-[8px_8px_0_0_rgba(0,0,0,1)] text-center">
          <PartyPopper className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
          <h2 className="text-3xl font-black mb-4">約局建立成功！</h2>
          <p className="text-lg mb-6">請將以下報名驗證碼提供給想報名的參加者：</p>
          <div className="bg-stone-100 border-4 border-black p-6 rounded-xl mb-8 inline-block">
            <p className="text-sm font-bold text-stone-500 mb-2 uppercase tracking-widest">Booking Code</p>
            <p className="text-5xl font-black tracking-widest text-orange-500">{createdSession.booking_code}</p>
          </div>
          <p className="text-stone-600 mb-8 font-bold">參加者需要此驗證碼才能成功報名。</p>
          <button
            onClick={() => navigate(`/session/${createdSession.id}`)}
            className="brutal-btn bg-emerald-400 hover:bg-emerald-500 text-black px-8 py-3 text-xl w-full sm:w-auto"
          >
            前往約局頁面
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="mb-6 text-center">
        <p className="text-stone-600 font-bold text-sm sm:text-base">
          填寫以下詳細資訊來開始組織你的下一場聚會。
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="brutal-card p-1 sm:p-1.5"
      >
        <div className="space-y-0.5">
          <div className="flex flex-wrap gap-1 sm:gap-1.5 mb-0">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="eventType"
                value="boardgame"
                checked={eventType === "boardgame"}
                onChange={() => handleEventTypeChange("boardgame")}
                className="w-5 h-5 accent-orange-600"
              />
              <span className="text-base sm:text-lg font-black text-stone-900 whitespace-nowrap leading-none">🎲 桌遊局</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="eventType"
                value="mahjong"
                checked={eventType === "mahjong"}
                onChange={() => handleEventTypeChange("mahjong")}
                className="w-5 h-5 accent-orange-600"
              />
              <span className="text-base sm:text-lg font-black text-stone-900 whitespace-nowrap leading-none">🀄 雀局</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="eventType"
                value="social"
                checked={eventType === "social"}
                onChange={() => handleEventTypeChange("social")}
                className="w-5 h-5 accent-orange-600"
              />
              <span className="text-base sm:text-lg font-black text-stone-900 whitespace-nowrap leading-none">🤝 交友聚會</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-0.5">
            <div>
              <label
                htmlFor="hostName"
                className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
              >
                你的名字
              </label>
              <input
                type="text"
                id="hostName"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                placeholder="例如：小池"
                required
              />
            </div>

            <div>
              <label
                htmlFor="hostWhatsapp"
                className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
              >
                WhatsApp 號碼 (必填)
              </label>
              <input
                type="tel"
                id="hostWhatsapp"
                value={hostWhatsapp}
                onChange={(e) => setHostWhatsapp(e.target.value)}
                className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                placeholder="例如：91234567"
                required
              />
            </div>
          </div>

          {eventType !== "social" && (
            <div>
              <label
                htmlFor="gameName"
                className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
              >
                {eventType === "mahjong" ? "想打的牌" : "想玩的遊戲"}
              </label>
              {eventType === "mahjong" ? (
                <select
                  id="gameName"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base bg-white leading-tight"
                  required
                >
                  <option value="港式台牌">港式台牌</option>
                  <option value="廣東牌">廣東牌</option>
                  <option value="跑馬仔">跑馬仔</option>
                  <option value="越南百搭">越南百搭</option>
                </select>
              ) : (
                <input
                  type="text"
                  id="gameName"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                  placeholder="例如：卡坦島、殖民火星"
                  required
                />
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="location"
              className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
            >
              聚會地點 (選填)
            </label>
            <input
              type="text"
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
              placeholder="例如: 池記桌遊 荔枝角桌遊旅人 旺角桌遊店"
            />
          </div>

          {eventType === "social" && (
            <>
              <div>
                <label
                  htmlFor="purpose"
                  className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
                >
                  聚會目的 (選填)
                </label>
                <input
                  type="text"
                  id="purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                  placeholder="例如:純交友"
                />
              </div>
              <div>
                <label
                  htmlFor="content"
                  className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
                >
                  聚會內容 (必填)
                </label>
                <input
                  type="text"
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                  placeholder="例如:打牌+桌遊 新手桌遊和打機"
                  required
                />
              </div>
            </>
          )}

          {eventType === "mahjong" && (
            <div>
              <label
                htmlFor="rules"
                className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
              >
                特別規則/玩法 (選填)
              </label>
              <input
                type="text"
                id="rules"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                placeholder="例如：八隻白雪雪 三色 蛇圍北換 有花 冇花"
              />
            </div>
          )}

          {eventType !== "mahjong" && (
            <>
              <div>
                <label
                  htmlFor="playerCount"
                  className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
                >
                  理想遊玩人數
                </label>
                <select
                  id="playerCount"
                  value={playerCount}
                  onChange={(e) => setPlayerCount(e.target.value)}
                  className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base bg-white leading-tight"
                >
                  <option value="2">2 人</option>
                  <option value="3">3 人</option>
                  <option value="4">4 人</option>
                  <option value="3-4">3-4 人</option>
                  <option value="5">5 人</option>
                  <option value="5+">5 人以上</option>
                  <option value="Any">不限</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-0.5">
                <div>
                  <label
                    htmlFor="minPlayers"
                    className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
                  >
                    最少幾人成團
                  </label>
                  <input
                    type="number"
                    id="minPlayers"
                    min="2"
                    max="20"
                    value={minPlayers}
                    onChange={(e) => setMinPlayers(e.target.value)}
                    className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="maxPlayers"
                    className="block text-sm sm:text-base font-bold text-stone-900 mb-0 leading-none"
                  >
                    最多幾人
                  </label>
                  <input
                    type="number"
                    id="maxPlayers"
                    min="2"
                    max="20"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(e.target.value)}
                    className="brutal-input w-full px-1 py-0.5 text-sm sm:text-base leading-tight"
                    required
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <div className="flex items-center justify-between mb-0">
              <label className="block text-sm sm:text-base font-bold text-stone-900 leading-none">
                提議的日期與時間
              </label>
            </div>
            <div className="space-y-0.5 mt-0.5">
              {dateOptions.map((opt, index) => (
                <div key={index} className="flex items-center gap-0.5">
                  <div className="relative flex-1 flex flex-col sm:flex-row gap-0.5">
                    <input
                      type="date"
                      min={format(new Date(), 'yyyy-MM-dd')}
                      value={opt.date}
                      onChange={(e) => handleDateChange(index, 'date', e.target.value)}
                      className="brutal-input w-full sm:w-2/5 px-1 py-0.5 text-sm sm:text-base leading-tight"
                      required
                    />
                    <div className="flex items-center gap-0.5 w-full sm:w-3/5">
                      <select
                        value={opt.startTime}
                        onChange={(e) => handleDateChange(index, 'startTime', e.target.value)}
                        className="brutal-input flex-1 px-1 py-0.5 text-sm sm:text-base bg-white leading-tight"
                      >
                        {Array.from({ length: 24 }).flatMap((_, h) => 
                          ['00', '15', '30', '45'].map(m => {
                            const hour = h.toString().padStart(2, '0');
                            return <option key={`${hour}:${m}`} value={`${hour}:${m}`}>{`${hour}${m}`}</option>;
                          })
                        )}
                      </select>
                      <span className="font-bold leading-none">-</span>
                      <select
                        value={opt.endTime}
                        onChange={(e) => handleDateChange(index, 'endTime', e.target.value)}
                        className="brutal-input flex-1 px-1 py-0.5 text-sm sm:text-base bg-white leading-tight"
                      >
                        {Array.from({ length: 24 }).flatMap((_, h) => 
                          ['00', '15', '30', '45'].map(m => {
                            const hour = h.toString().padStart(2, '0');
                            return <option key={`${hour}:${m}`} value={`${hour}:${m}`}>{`${hour}${m}`}</option>;
                          })
                        )}
                      </select>
                    </div>
                  </div>
                  {dateOptions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDate(index)}
                      className="p-0.5 text-black hover:bg-rose-400 border-2 border-transparent hover:border-black rounded-lg transition-all"
                      aria-label="移除日期"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAddDate}
              className="mt-0.5 flex items-center gap-1 text-sm font-black text-orange-600 hover:text-orange-700 transition-colors bg-white px-1.5 py-0.5 border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] rounded-lg leading-none"
            >
              <Plus className="w-3 h-3 stroke-[3]" />
              新增其他時間選項
            </button>
          </div>
        </div>

        <div className="mt-1.5 pt-1.5 border-t-4 border-black flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="brutal-btn bg-rose-400 hover:bg-rose-500 text-black px-4 py-1.5 text-base sm:text-lg disabled:opacity-50 disabled:cursor-not-allowed leading-tight"
          >
            {isSubmitting ? "建立中..." : "建立約局"}
          </button>
        </div>
      </form>
    </div>
  );
}
