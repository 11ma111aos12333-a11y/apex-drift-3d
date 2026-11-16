import React from 'react';
import { Sliders, Wrench, Play, Globe } from 'lucide-react';
import { Language } from '../types/game';
import { t } from '../i18n/translations';

interface TitleScreenProps {
  lang: Language;
  onToggleLang: () => void;
  onQuickStart: () => void;
  onOpenModeSelect: () => void;
  onOpenGarage: () => void;
  onOpenSettings: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  lang,
  onToggleLang,
  onQuickStart,
  onOpenModeSelect,
  onOpenGarage,
  onOpenSettings,
}) => {
  return (
    <div className="fixed inset-0 z-10 flex flex-col justify-between pointer-events-none p-5 md:p-10">
      {/* Top Safe Bar: Brand emblem + Language / Settings */}
      <div className="flex items-start justify-between gap-4">
        <div
          className="pointer-events-auto max-w-md rounded-xl p-5 border border-white/10"
          style={{ background: 'rgba(9, 12, 18, 0.78)' }}
        >
          {/* Bespoke inline SVG Title Crest */}
          <div className="flex items-center gap-3 mb-2">
            <svg
              width="42"
              height="42"
              viewBox="0 0 48 48"
              fill="none"
              aria-hidden="true"
              className="shrink-0"
            >
              <path
                d="M6 34L16 12H36L42 22L28 36H6Z"
                fill="#f59e0b"
                fillOpacity="0.18"
                stroke="#f59e0b"
                strokeWidth="2.5"
              />
              <path
                d="M14 28L22 16H33L25 28H14Z"
                fill="#06b6d4"
              />
              <path
                d="M8 34H32"
                stroke="#f8fafc"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <div>
              <h1 className="font-display text-2xl md:text-4xl font-bold tracking-tight text-white leading-none">
                {t(lang, 'appTitle')}
              </h1>
              <p className="text-xs md:text-sm text-slate-300 mt-1">
                {t(lang, 'appSubtitle')}
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleLang}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold text-slate-100 border border-white/15 hover:border-amber-400/60 transition-colors cursor-pointer whitespace-nowrap"
            style={{ background: 'rgba(15, 23, 42, 0.84)' }}
          >
            <Globe className="w-4 h-4 text-cyan-400" />
            <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t(lang, 'settings')}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold text-slate-100 border border-white/15 hover:border-amber-400/60 transition-colors cursor-pointer whitespace-nowrap"
            style={{ background: 'rgba(15, 23, 42, 0.84)' }}
          >
            <Sliders className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">{t(lang, 'settings')}</span>
          </button>
        </div>
      </div>

      {/* Bottom Primary Menu Actions (<= 3 actions, leaving center 3D car showcase clear) */}
      <div className="flex flex-col items-start gap-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onQuickStart}
            className="flex items-center gap-2.5 px-7 py-3.5 rounded-xl text-base font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-amber-500/20 whitespace-nowrap"
          >
            <Play className="w-5 h-5 fill-slate-950" />
            <span>{t(lang, 'startGame')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenModeSelect}
            className="flex items-center gap-2 px-5 py-3.5 rounded-xl text-sm font-semibold text-white border border-white/20 hover:border-cyan-400/70 transition-colors cursor-pointer whitespace-nowrap"
            style={{ background: 'rgba(15, 23, 42, 0.86)' }}
          >
            <span>{t(lang, 'chooseMode')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenGarage}
            className="flex items-center gap-2 px-5 py-3.5 rounded-xl text-sm font-semibold text-white border border-white/20 hover:border-amber-400/70 transition-colors cursor-pointer whitespace-nowrap"
            style={{ background: 'rgba(15, 23, 42, 0.86)' }}
          >
            <Wrench className="w-4 h-4 text-amber-400" />
            <span>{t(lang, 'garage')}</span>
          </button>
        </div>

        <p className="text-xs text-slate-300/90 font-medium tracking-wide">
          {t(lang, 'controlsHint')}
        </p>
      </div>
    </div>
  );
};
