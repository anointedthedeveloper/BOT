import { UserError } from '../utils/errors.js';

export default {
  name: 'weather',
  description: 'Get current weather for a city',
  usage: 'weather <city>',
  async execute(ctx) {
    const city = ctx.argText.trim();
    if (!city) throw new UserError('Usage: ,weather Lagos');

    let data;
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      if (!res.ok) throw new Error('bad response');
      data = await res.json();
    } catch {
      throw new UserError('Could not fetch weather. Check the city name and try again.');
    }

    const cur = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!cur) throw new UserError('No weather data found for that location.');

    const name = area?.areaName?.[0]?.value ?? city;
    const country = area?.country?.[0]?.value ?? '';
    const temp = cur.temp_C;
    const feels = cur.FeelsLikeC;
    const desc = cur.weatherDesc?.[0]?.value ?? '';
    const humidity = cur.humidity;
    const wind = cur.windspeedKmph;

    await ctx.reply([
      `╭─「 🌤️ *Weather — ${name}, ${country}* 」`,
      `│ 🌡️ Temp: *${temp}°C* (feels like ${feels}°C)`,
      `│ 🌥️ Condition: *${desc}*`,
      `│ 💧 Humidity: *${humidity}%*`,
      `│ 💨 Wind: *${wind} km/h*`,
      `╰────────────────────`,
    ].join('\n'));
  },
};
