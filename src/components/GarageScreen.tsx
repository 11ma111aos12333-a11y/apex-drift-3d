import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { CARS, PAINT_PALETTE, RIM_PALETTE, UNDERGLOW_PALETTE, getCarById } from '../data/cars';
import { CarCustomization, Language } from '../types/game';
import { t } from '../i18n/translations';

interface GarageScreenProps {
  lang: Language;
  selectedCarId: string;
  customization: CarCustomization;
  onSelectCar: (carId: string) => void;
  onChangeCustomization: (next: CarCustomization) => void;
  onBack: () => void;
  onDriveSelected: () => void;
}

export const GarageScreen: React.FC<GarageScreenProps> = ({
  lang,
  selectedCarId,
  customization,
  onSelectCar,
  onChangeCustomization,
  onBack,
  onDriveSelected,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'cars' | 'paint' | 'stats'>('cars');
  const car = getCarById(selectedCarId);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 md:p-6">
      {/* Top Minimal Bar */}
      <div className="flex items-center justify-between gap-4">
        <div
          className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/15"
          style={{ background: 'rgba(9, 12, 18, 0.85)' }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label={t(lang, 'back')}
            className="p-1.5 rounded-lg text-slate-200 hover:bg-white/10 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="font-display text-base md:text-lg font-bold text-white leading-tight">
              {lang === 'ar' ? car.nameAr : car.nameEn}
            </h2>
            <p className="text-xs text-slate-300">
              {t(lang, 'garageTitle')} · {t(lang, 'unlockedFree')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDriveSelected}
          className="pointer-events-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 cursor-pointer whitespace-nowrap shadow-lg"
        >
          <Check className="w-4 h-4" />
          <span>{t(lang, 'driveThisCar')}</span>
        </button>
      </div>

      {/* Collapsible Bottom Control Dock (Center 3D Viewport stays 100% unobstructed) */}
      <div className="flex flex-col items-center w-full">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="pointer-events-auto mb-1.5 flex items-center gap-1.5 px-3.5 py-1 rounded-t-lg text-xs font-medium text-slate-200 border border-b-0 border-white/15 cursor-pointer"
          style={{ background: 'rgba(15, 23, 42, 0.9)' }}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? t(lang, 'garage') : '360°'}</span>
        </button>

        {!collapsed && (
          <div
            className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-white/15 p-4"
            style={{ background: 'rgba(9, 12, 18, 0.92)' }}
          >
            {/* Dock Section Tabs */}
            <div className="flex items-center justify-between gap-2 mb-3 border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="garage-tab-cars"
                  onClick={() => setTab('cars')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    tab === 'cars'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {lang === 'ar' ? 'السيارات (6)' : 'Vehicles (6)'}
                </button>
                <button
                  type="button"
                  data-testid="garage-tab-paint"
                  onClick={() => setTab('paint')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    tab === 'paint'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {lang === 'ar' ? 'الطلاء والتعديل' : 'Customization'}
                </button>
                <button
                  type="button"
                  data-testid="garage-tab-stats"
                  onClick={() => setTab('stats')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    tab === 'stats'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {lang === 'ar' ? 'مواصفات الفيزياء' : 'Physics Specs'}
                </button>
              </div>
              <span className="hidden md:inline text-xs text-slate-400">
                {lang === 'ar' ? car.taglineAr : car.taglineEn}
              </span>
            </div>

            {/* Tab 1: 6 Unlocked Cars */}
            {tab === 'cars' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {CARS.map((item) => {
                  const active = item.id === selectedCarId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`car-card-${item.id}`}
                      onClick={() => onSelectCar(item.id)}
                      className={`text-start p-2.5 rounded-xl border transition-colors cursor-pointer ${
                        active
                          ? 'border-amber-400 bg-amber-500/15'
                          : 'border-white/10 bg-white/5 hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0"
                          style={{ backgroundColor: item.defaultPaint }}
                        />
                        <span className="font-telemetry text-[11px] text-amber-400">
                          {item.stats.topSpeedKmh}
                        </span>
                      </div>
                      <div className="text-xs font-bold text-white truncate">
                        {lang === 'ar' ? item.nameAr : item.nameEn}
                      </div>
                      <div className="text-[11px] text-slate-400 uppercase mt-0.5">
                        {item.category}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Tab 2: Paint, Rims, Underglow, Window Tint */}
            {tab === 'paint' && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-2">
                    {t(lang, 'paintColor')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PAINT_PALETTE.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        data-testid={`paint-swatch-${c.hex}`}
                        aria-label={lang === 'ar' ? c.nameAr : c.nameEn}
                        onClick={() =>
                          onChangeCustomization({ ...customization, paintColor: c.hex })
                        }
                        className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                          customization.paintColor === c.hex
                            ? 'border-white scale-110'
                            : 'border-white/20'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-2">
                    {t(lang, 'rimColor')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {RIM_PALETTE.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        aria-label={lang === 'ar' ? c.nameAr : c.nameEn}
                        onClick={() =>
                          onChangeCustomization({ ...customization, rimColor: c.hex })
                        }
                        className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                          customization.rimColor === c.hex
                            ? 'border-amber-400 scale-110'
                            : 'border-white/20'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-2">
                    {t(lang, 'underglow')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {UNDERGLOW_PALETTE.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        aria-label={lang === 'ar' ? c.nameAr : c.nameEn}
                        onClick={() =>
                          onChangeCustomization({ ...customization, underglowColor: c.hex })
                        }
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                          customization.underglowColor === c.hex
                            ? 'border-cyan-400 text-white bg-cyan-500/20'
                            : 'border-white/15 text-slate-300 bg-white/5'
                        }`}
                      >
                        {lang === 'ar' ? c.nameAr : c.nameEn}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">
                    {t(lang, 'windowTint')} ({Math.round(customization.windowTint * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.2}
                    max={0.85}
                    step={0.05}
                    value={customization.windowTint}
                    onChange={(e) =>
                      onChangeCustomization({
                        ...customization,
                        windowTint: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* Tab 3: Real Physics Telemetry Bars */}
            {tab === 'stats' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2.5">
                {[
                  { label: t(lang, 'statSpeed'), val: Math.round((car.stats.topSpeedKmh / 380) * 100), raw: `${car.stats.topSpeedKmh} ${t(lang, 'kmh')}` },
                  { label: t(lang, 'statAccel'), val: car.stats.acceleration, raw: `${car.stats.acceleration}/100` },
                  { label: t(lang, 'statHandling'), val: car.stats.handling, raw: `${car.stats.handling}/100` },
                  { label: t(lang, 'statBraking'), val: car.stats.braking, raw: `${car.stats.braking}/100` },
                  { label: t(lang, 'statDrift'), val: car.stats.driftControl, raw: `${car.stats.driftControl}/100` },
                  { label: t(lang, 'statOffroad'), val: car.stats.offroadGrip, raw: `${car.stats.offroadGrip}/100` },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">{s.label}</span>
                      <span className="font-telemetry text-amber-400">{s.raw}</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${Math.min(100, s.val)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
