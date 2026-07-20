import { useState } from 'react';
import { GameState } from '../types/game';
import { sendAdminCommand } from '../utils/socket';

interface AdminControlsProps {
  activeGameId: string | null;
  gameState: GameState | null;
}

export function AdminControls({ activeGameId, gameState }: AdminControlsProps) {
  const [triviaCategory, setTriviaCategory] = useState('all');
  const [triviaTimer, setTriviaTimer] = useState('15');
  const [triviaRounds, setTriviaRounds] = useState('10');
  const [guessAnswer, setGuessAnswer] = useState('');
  const [drawingWord, setDrawingWord] = useState('');
  const [searchZone, setSearchZone] = useState('');

  if (!activeGameId) return null;

  const renderControls = () => {
    switch (activeGameId) {
      case 'trivia':
        return (
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={triviaCategory}
              onChange={(e) => setTriviaCategory(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            >
              <option value="all">جميع الفئات</option>
              <option value="ألعاب">ألعاب</option>
              <option value="ثقافة عامة">ثقافة عامة</option>
              <option value="تاريخ">تاريخ</option>
              <option value="علوم">علوم</option>
            </select>
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('trivia:start', triviaCategory)}>
              ▶ ابدأ
            </button>
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('trivia:next')}>
              تخطي السؤال
            </button>
            <label className="text-[var(--text-dim)] text-xs flex items-center gap-1">
              الوقت:
              <input
                type="number"
                value={triviaTimer}
                onChange={(e) => {
                  setTriviaTimer(e.target.value);
                  sendAdminCommand('trivia:setTimer', parseInt(e.target.value));
                }}
                className="w-12 text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded px-2 py-1 outline-none"
              />ث
            </label>
            <label className="text-[var(--text-dim)] text-xs flex items-center gap-1">
              جولات:
              <input
                type="number"
                value={triviaRounds}
                onChange={(e) => {
                  setTriviaRounds(e.target.value);
                  sendAdminCommand('trivia:setRounds', parseInt(e.target.value));
                }}
                className="w-12 text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded px-2 py-1 outline-none"
              />
            </label>
          </div>
        );

      case 'musical_chairs':
        return (
          <div className="flex gap-2 flex-wrap">
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('mc:start')}>
              افتح الصالة (!دخول)
            </button>
            <button className="btn-neon-pink text-sm" onClick={() => sendAdminCommand('mc:closeLobby')}>
              أغلق الصالة
            </button>
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('mc:startSeating')}>
              أوقف الموسيقى (!جلوس)
            </button>
            <button className="btn-neon-pink text-sm" onClick={() => sendAdminCommand('mc:reset')}>
              إعادة تعيين
            </button>
          </div>
        );

      case 'mafia':
        return (
          <div className="flex gap-2 flex-wrap">
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('mafia:assignRoles')}>
              توزيع الأدوار
            </button>
          </div>
        );

      case 'guessing':
        return (
          <div className="flex gap-2 items-center">
            <input
              placeholder="أدخل الإجابة..."
              value={guessAnswer}
              onChange={(e) => setGuessAnswer(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            />
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('guessing:setAnswer', guessAnswer)}>
              تعيين الإجابة
            </button>
          </div>
        );

      case 'drawing':
        return (
          <div className="flex gap-2 items-center">
            <input
              placeholder="أدخل الكلمة..."
              value={drawingWord}
              onChange={(e) => setDrawingWord(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            />
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('drawing:setWord', drawingWord)}>
              تعيين الكلمة
            </button>
          </div>
        );

      case 'hide_and_seek':
        return (
          <div className="flex gap-2 items-center">
            <input
              placeholder="المنطقة (مثلاً A1)"
              value={searchZone}
              onChange={(e) => setSearchZone(e.target.value.toUpperCase())}
              className="w-20 text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            />
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('hs:searchZone', searchZone)}>
              ابحث في المنطقة
            </button>
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('hs:startHiding')}>
              بدء الاختباء
            </button>
          </div>
        );

      default:
        return <span className="text-[var(--text-muted)] text-sm">لا توجد أدوات تحكم</span>;
    }
  };

  return (
    <div className="panel flex items-center gap-2 flex-wrap">
      <span className="badge badge-pink text-[0.65rem] mr-1">
        تحكم المشرف
      </span>
      {renderControls()}
    </div>
  );
}
