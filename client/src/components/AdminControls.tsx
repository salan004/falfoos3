import { useState } from 'react';
import { GameState } from '../types/game';
import { sendAdminCommand } from '../utils/socket';
import { GameSettingsPanel } from './game-settings/GameSettingsPanel';
import { GameSettingsDisplay } from './game-settings/GameSettingsDisplay';
import { useSocketEvent } from '../hooks/useWebSocket';

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
  const [serverSettingsErrors, setServerSettingsErrors] = useState<string[] | null>(null);

  useSocketEvent('mafia:settingsError', (payload) => {
    const errors = (payload as { errors?: string[] }).errors;
    setServerSettingsErrors(
      Array.isArray(errors) && errors.length > 0
        ? errors
        : ['حدث خطأ غير معروف أثناء حفظ الإعدادات']
    );
  });

  useSocketEvent('mafia:settingsUpdated', () => {
    setServerSettingsErrors(null);
  });

  if (!activeGameId) return null;

  const isMafia = activeGameId === 'mafia';
  const phase = gameState?.phase;
  const settingsEditable = !phase || phase === 'idle' || phase === 'lobby';

  const renderControls = () => {
    const controls: React.ReactNode[] = [];

    if (isMafia) {
      if (settingsEditable) {
        controls.push(
          <GameSettingsPanel
            key="mafia-settings"
            activeGameId="mafia"
            isLocked={false}
            serverErrors={serverSettingsErrors}
          />
        );
      } else {
        controls.push(
          <GameSettingsDisplay
            key="mafia-settings-display"
            gameId="mafia"
            settings={gameState?.activeSettings ?? {}}
            isLocked={true}
          />
        );
      }

      controls.push(
        <div className="flex gap-2 flex-wrap">
          <button className="btn-neon text-sm" onClick={() => sendAdminCommand('mafia:start')}>
            ▶ بدء اللعبة
          </button>
          <button className="btn-neon text-sm" onClick={() => sendAdminCommand('mafia:nextPhase')}>
            ⏭ تقدم للمرحلة التالية
          </button>
          <button className="btn-neon-pink text-sm" onClick={() => sendAdminCommand('mafia:forceEnd')}>
            ⛔ إنهاء اللعبة
          </button>
          <button className="btn-neon-pink text-sm" onClick={() => sendAdminCommand('mafia:reset')}>
            🔄 إعادة تعيين
          </button>
        </div>
      );
    }

    switch (activeGameId) {
      case 'trivia':
        controls.push(
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
        break;

      case 'musical_chairs':
        controls.push(
          <div className="flex gap-2 flex-wrap">
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('mc:start')}>
              فتح الصالة يدوياً
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
        break;

      case 'guessing':
        controls.push(
          <div className="flex gap-2 items-center flex-wrap">
            <input
              placeholder="أدخل الإجابة..."
              value={guessAnswer}
              onChange={(e) => setGuessAnswer(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            />
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('guessing:setAnswer', guessAnswer)}>
              تعيين الإجابة
            </button>
            <button className="btn-neon-pink text-sm" onClick={() => { sendAdminCommand('guessing:reset'); setGuessAnswer(''); }}>
              🔄 إعادة تعيين
            </button>
          </div>
        );
        break;

      case 'drawing':
        controls.push(
          <div className="flex gap-2 items-center flex-wrap">
            <input
              placeholder="أدخل الكلمة..."
              value={drawingWord}
              onChange={(e) => setDrawingWord(e.target.value)}
              className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan"
            />
            <button className="btn-neon text-sm" onClick={() => sendAdminCommand('drawing:setWord', drawingWord)}>
              تعيين الكلمة
            </button>
            <button className="btn-neon-pink text-sm" onClick={() => { sendAdminCommand('drawing:reset'); setDrawingWord(''); }}>
              🔄 إعادة تعيين
            </button>
          </div>
        );
        break;

      case 'hide_and_seek':
        controls.push(
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
        break;

      default:
        controls.push(<span className="text-[var(--text-muted)] text-sm">لا توجد أدوات تحكم</span>);
    }

    return <div className="flex flex-wrap gap-2">{controls}</div>;
  };

  if (!activeGameId) return null;

  return (
    <div className="panel flex items-center gap-2 flex-wrap">
      <span className="badge badge-pink text-[0.65rem] mr-1">
        تحكم المشرف
      </span>
      {renderControls()}
    </div>
  );
}