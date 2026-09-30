export const SECONDS_PER_YEAR_DAY = 1150;
export const DAYS_PER_YEAR = 365;
const BASE_STAGE_SECONDS = Object.freeze({
  preDawn: 20,
  dawn: 30,
  morning: 220,
  noon: 160,
  afternoon: 220,
  dusk: 80,
  night: 420,
});

export const TIME_STAGES = Object.freeze([
  { id: 'preDawn', label: '凌晨' },
  { id: 'dawn', label: '晨曦' },
  { id: 'morning', label: '上午' },
  { id: 'noon', label: '中午' },
  { id: 'afternoon', label: '下午' },
  { id: 'dusk', label: '黄昏' },
  { id: 'night', label: '夜晚' },
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function hoursToStageSeconds(hours) {
  return Math.max(0, hours) / 24 * SECONDS_PER_YEAR_DAY;
}

function wrapDayOfYear(dayOfYear) {
  return ((dayOfYear - 1) % DAYS_PER_YEAR + DAYS_PER_YEAR) % DAYS_PER_YEAR + 1;
}

export function getSeasonId(dayOfYear) {
  if (dayOfYear < 80 || dayOfYear >= 355) {
    return 'winter';
  }

  if (dayOfYear < 172) {
    return 'spring';
  }

  if (dayOfYear < 264) {
    return 'summer';
  }

  return 'autumn';
}

export function getSolarProfile(dayOfYear, latitude = 35) {
  const latitudeRadians = degreesToRadians(latitude);
  const declination = degreesToRadians(23.44) * Math.sin((2 * Math.PI * (284 + dayOfYear)) / DAYS_PER_YEAR);
  const hourAngle = Math.acos(clamp(-Math.tan(latitudeRadians) * Math.tan(declination), -1, 1));
  const daylightHours = (2 * hourAngle * 180) / (Math.PI * 15);
  const sunriseHour = 12 - daylightHours / 2;
  const sunsetHour = 12 + daylightHours / 2;

  return {
    daylightHours,
    nightHours: 24 - daylightHours,
    sunriseHour,
    sunsetHour,
  };
}

export function buildStageDurations(dayOfYear, latitude) {
  const solarProfile = getSolarProfile(dayOfYear, latitude);
  const dawnEndHour = Math.min(solarProfile.sunsetHour, solarProfile.sunriseHour + 0.75);
  const noonStartHour = clamp(11.25, dawnEndHour, solarProfile.sunsetHour);
  const noonEndHour = clamp(12.75, noonStartHour, solarProfile.sunsetHour);
  const duskEndHour = Math.min(24, solarProfile.sunsetHour + 0.75);
  const clockHours = {
    preDawn: solarProfile.sunriseHour,
    dawn: dawnEndHour - solarProfile.sunriseHour,
    morning: noonStartHour - dawnEndHour,
    noon: noonEndHour - noonStartHour,
    afternoon: solarProfile.sunsetHour - noonEndHour,
    dusk: duskEndHour - solarProfile.sunsetHour,
    night: 24 - duskEndHour,
  };

  return TIME_STAGES.map((stage) => ({
    ...stage,
    seconds: hoursToStageSeconds(clockHours[stage.id]),
  }));
}

export function buildYearStageCalendar(latitude = 35) {
  return Array.from({ length: DAYS_PER_YEAR }, (_, index) => {
    const dayOfYear = index + 1;
    const solarProfile = getSolarProfile(dayOfYear, latitude);

    return {
      dayOfYear,
      seasonId: getSeasonId(dayOfYear),
      solarProfile,
      stages: buildStageDurations(dayOfYear, latitude),
    };
  });
}

export function findStage(stages, daySeconds) {
  let elapsed = 0;

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];

    if (daySeconds < elapsed + stage.seconds) {
      const nextStage = stages[(index + 1) % stages.length];

      return {
        stage,
        nextStage,
        stageIndex: index,
        stageProgress: (daySeconds - elapsed) / stage.seconds,
      };
    }

    elapsed += stage.seconds;
  }

  return {
    stage: stages[stages.length - 1],
    nextStage: stages[0],
    stageIndex: stages.length - 1,
    stageProgress: 1,
  };
}

export class TimeSystem {
  constructor({
    eventBus,
    latitude = 35,
    startDayOfYear = 172,
    startSeconds = 50,
  }) {
    this.eventBus = eventBus;
    this.latitude = latitude;
    this.elapsedSeconds = startSeconds;
    this.dayOfYear = startDayOfYear;
    this.lastEmittedDay = startDayOfYear;
    this.manualTimeChange = null;
    this.stages = buildStageDurations(this.dayOfYear, this.latitude);
    this.unsubscribe = [
      eventBus.on('time:set-minutes', ({ minutes }) => this.setClockMinutes(minutes)),
      eventBus.on('time:shift-minutes', ({ minutes }) => this.shiftClockMinutes(minutes)),
    ];

    this.normalizeElapsedSeconds();
  }

  setClockMinutes(minutes) {
    const totalMinutes = 24 * 60;
    const normalizedMinutes = ((Math.round(minutes) % totalMinutes) + totalMinutes) % totalMinutes;

    this.manualTimeChange = {
      type: 'set',
      minutes: normalizedMinutes,
    };
    this.elapsedSeconds = (normalizedMinutes / totalMinutes) * SECONDS_PER_YEAR_DAY;
    this.stages = buildStageDurations(this.dayOfYear, this.latitude);
    this.update(0);
  }

  shiftClockMinutes(minutes) {
    const seconds = (minutes / (24 * 60)) * SECONDS_PER_YEAR_DAY;

    this.manualTimeChange = {
      type: 'shift',
      minutes,
    };
    this.advanceSeconds(seconds);
    this.update(0);
  }

  update(deltaTime) {
    this.advanceSeconds(deltaTime);

    const solarProfile = getSolarProfile(this.dayOfYear, this.latitude);
    const stageState = findStage(this.stages, this.elapsedSeconds);
    const payload = {
      dayOfYear: this.dayOfYear,
      seasonId: getSeasonId(this.dayOfYear),
      normalizedDay: this.elapsedSeconds / SECONDS_PER_YEAR_DAY,
      secondsInDay: this.elapsedSeconds,
      secondsPerDay: SECONDS_PER_YEAR_DAY,
      isManualTimeChange: Boolean(this.manualTimeChange),
      manualTimeChange: this.manualTimeChange,
      stages: this.stages,
      solarProfile,
      ...stageState,
    };

    if (this.dayOfYear !== this.lastEmittedDay) {
      this.eventBus.emit('time:new-day', payload);
      this.lastEmittedDay = this.dayOfYear;
    }

    this.eventBus.emit('time:update', payload);
    this.manualTimeChange = null;
  }

  advanceSeconds(seconds) {
    this.elapsedSeconds += seconds;
    this.normalizeElapsedSeconds();
  }

  normalizeElapsedSeconds() {
    let dayShift = 0;

    while (this.elapsedSeconds >= SECONDS_PER_YEAR_DAY) {
      this.elapsedSeconds -= SECONDS_PER_YEAR_DAY;
      dayShift += 1;
    }

    while (this.elapsedSeconds < 0) {
      this.elapsedSeconds += SECONDS_PER_YEAR_DAY;
      dayShift -= 1;
    }

    if (dayShift !== 0) {
      this.dayOfYear = wrapDayOfYear(this.dayOfYear + dayShift);
      this.stages = buildStageDurations(this.dayOfYear, this.latitude);
    }
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}
