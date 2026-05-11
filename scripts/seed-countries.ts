/**
 * Справочник стран с aliases для fuzzy-матчинга (PRD §6.1).
 * Зависимости: @prisma/client.
 *
 * top-страны (isTopCountry=true) показываются как кнопки в анкете (PRD §5.4).
 * Остальные доступны только через текстовый ввод "Другое".
 * Aliases растут самостоятельно: при подтверждении пользователем — добавляются автоматически.
 */
import type { PrismaClient } from '@prisma/client';

type CountrySeed = {
  name: string;
  isoCode: string;
  timezone: string;
  flagEmoji: string;
  isTopCountry: boolean;
  nameAliases: string[];
};

const COUNTRIES: CountrySeed[] = [
  // top-4 — показываются кнопками в дефолтной анкете (PRD §4)
  {
    name: 'Украина',
    isoCode: 'UA',
    timezone: 'Europe/Kyiv',
    flagEmoji: '🇺🇦',
    isTopCountry: true,
    nameAliases: ['украина', 'ukraine', 'украiна', 'украïна', 'ua', 'ukr', 'укр'],
  },
  {
    name: 'Россия',
    isoCode: 'RU',
    timezone: 'Europe/Moscow',
    flagEmoji: '🇷🇺',
    isTopCountry: true,
    nameAliases: ['россия', 'russia', 'росія', 'rf', 'рф', 'ru', 'рос'],
  },
  {
    name: 'Беларусь',
    isoCode: 'BY',
    timezone: 'Europe/Minsk',
    flagEmoji: '🇧🇾',
    isTopCountry: true,
    nameAliases: ['беларусь', 'belarus', 'білорусь', 'белоруссия', 'by', 'бел'],
  },
  {
    name: 'Польша',
    isoCode: 'PL',
    timezone: 'Europe/Warsaw',
    flagEmoji: '🇵🇱',
    isTopCountry: true,
    nameAliases: ['польша', 'polska', 'poland', 'польща', 'pl'],
  },
  // остальные доступны через текстовый ввод
  {
    name: 'Казахстан',
    isoCode: 'KZ',
    timezone: 'Asia/Almaty',
    flagEmoji: '🇰🇿',
    isTopCountry: false,
    nameAliases: ['казахстан', 'kazakhstan', 'қазақстан', 'kz', 'каз'],
  },
  {
    name: 'Узбекистан',
    isoCode: 'UZ',
    timezone: 'Asia/Tashkent',
    flagEmoji: '🇺🇿',
    isTopCountry: false,
    nameAliases: ['узбекистан', 'uzbekistan', 'oʻzbekiston', 'uz', 'узб'],
  },
  {
    name: 'Грузия',
    isoCode: 'GE',
    timezone: 'Asia/Tbilisi',
    flagEmoji: '🇬🇪',
    isTopCountry: false,
    nameAliases: ['грузия', 'georgia', 'საქართველო', 'ge'],
  },
  {
    name: 'Молдова',
    isoCode: 'MD',
    timezone: 'Europe/Chisinau',
    flagEmoji: '🇲🇩',
    isTopCountry: false,
    nameAliases: ['молдова', 'moldova', 'молдавия', 'md'],
  },
  {
    name: 'Литва',
    isoCode: 'LT',
    timezone: 'Europe/Vilnius',
    flagEmoji: '🇱🇹',
    isTopCountry: false,
    nameAliases: ['литва', 'lithuania', 'lietuva', 'lt'],
  },
  {
    name: 'Латвия',
    isoCode: 'LV',
    timezone: 'Europe/Riga',
    flagEmoji: '🇱🇻',
    isTopCountry: false,
    nameAliases: ['латвия', 'latvia', 'latvija', 'lv'],
  },
  {
    name: 'Эстония',
    isoCode: 'EE',
    timezone: 'Europe/Tallinn',
    flagEmoji: '🇪🇪',
    isTopCountry: false,
    nameAliases: ['эстония', 'estonia', 'eesti', 'ee'],
  },
  {
    name: 'Армения',
    isoCode: 'AM',
    timezone: 'Asia/Yerevan',
    flagEmoji: '🇦🇲',
    isTopCountry: false,
    nameAliases: ['армения', 'armenia', 'հայաստան', 'am'],
  },
  {
    name: 'Азербайджан',
    isoCode: 'AZ',
    timezone: 'Asia/Baku',
    flagEmoji: '🇦🇿',
    isTopCountry: false,
    nameAliases: ['азербайджан', 'azerbaijan', 'azərbaycan', 'az', 'азер'],
  },
  {
    name: 'Кыргызстан',
    isoCode: 'KG',
    timezone: 'Asia/Bishkek',
    flagEmoji: '🇰🇬',
    isTopCountry: false,
    nameAliases: ['кыргызстан', 'kyrgyzstan', 'киргизия', 'kg'],
  },
  {
    name: 'Таджикистан',
    isoCode: 'TJ',
    timezone: 'Asia/Dushanbe',
    flagEmoji: '🇹🇯',
    isTopCountry: false,
    nameAliases: ['таджикистан', 'tajikistan', 'тоҷикистон', 'tj'],
  },
  {
    name: 'Туркменистан',
    isoCode: 'TM',
    timezone: 'Asia/Ashgabat',
    flagEmoji: '🇹🇲',
    isTopCountry: false,
    nameAliases: ['туркменистан', 'turkmenistan', 'türkmenistan', 'tm'],
  },
  {
    name: 'Турция',
    isoCode: 'TR',
    timezone: 'Europe/Istanbul',
    flagEmoji: '🇹🇷',
    isTopCountry: false,
    nameAliases: ['турция', 'turkey', 'türkiye', 'tr'],
  },
  {
    name: 'Германия',
    isoCode: 'DE',
    timezone: 'Europe/Berlin',
    flagEmoji: '🇩🇪',
    isTopCountry: false,
    nameAliases: ['германия', 'germany', 'deutschland', 'de'],
  },
  {
    name: 'Чехия',
    isoCode: 'CZ',
    timezone: 'Europe/Prague',
    flagEmoji: '🇨🇿',
    isTopCountry: false,
    nameAliases: ['чехия', 'czech republic', 'česko', 'cz'],
  },
  {
    name: 'Израиль',
    isoCode: 'IL',
    timezone: 'Asia/Jerusalem',
    flagEmoji: '🇮🇱',
    isTopCountry: false,
    nameAliases: ['израиль', 'israel', 'ישראל', 'il'],
  },
];

export async function seedCountries(prisma: PrismaClient): Promise<number> {
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { isoCode: c.isoCode },
      update: {
        name: c.name,
        nameAliases: c.nameAliases,
        timezone: c.timezone,
        flagEmoji: c.flagEmoji,
        isTopCountry: c.isTopCountry,
      },
      create: c,
    });
  }
  return COUNTRIES.length;
}
