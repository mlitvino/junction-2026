# KUITTI — Брендбук и дизайн-система продукта
**Суббренд открытого протокола доверенных закупок для Valio Aimo® (Junction 2026)**

![KUITTI Brand Identity Board](E:\Programming Practice\junction-2026\docs\kuitti_brand_sheet.svg)

---

## 1. Название, легенда бренда и хук для питча

### Основное имя: **KUITTI** *(by Valio Aimo®)*
Для финского жюри из **Valio Aimo** слово **kuitti** мгновенно считывается на двух уровнях одновременно:
1. **Кухонный и торговый чек** (*kuitti* — бумажный тикет на алюминиевой рельсе шеф-повара, по которому живёт любая профессиональная кухня из 20 000 клиентов Valio Aimo).
2. **«Принято! / Подтверждаю!»** (в финском операционном и кухонном сленге возглас *«Kuitti!»* означает *«Понял, выполняю, сделка зафиксирована»* — идеальная метафора криптографического рукопожатия между внешним ИИ-агентом покупателя и системой Valio Aimo).

> [!TIP]
> **Готовая фраза для первых 15 секунд питча на сцене:**
> *«Every professional kitchen runs on tickets clipped to a pass rail — and in Finnish, "Kuitti!" means both "receipt" and "confirmed." While everyone else builds black-box AI chatbots, we built **KUITTI**: an open, verifiable trade-receipt protocol where autonomous kitchen agents negotiate with Valio Aimo cleanly, safely, and with human sign-off built right in.»*

### Слоган и альтернативные названия (если захотите другой оттенок)
- **Главный слоган:** `Zero Black Box. Every Order Signed.`
- **Подзаголовок протокола:** `Open Trade Receipt Protocol for Autonomous Foodservice`
- **Запасные варианты имени:**
  - **VARMUUS** *(фин. «уверенность / достоверность»)* — более строгий институциональный уклон в верификацию данных.
  - **AIMO RAIL** *(«рельса раздачи Aimo»)* — акцент на диспетчерской очереди заказов.

---

## 2. Логотип и графический знак

![KUITTI Primary Lockup](C:/Users/Administrator/.gemini/antigravity/brain/86060a37-841d-4d51-bd0a-28815e001a5e/kuitti_logo_mark.svg)

- **Конструкция знака:** Геометрический силуэт чека с характерным зубчатым отрывным краем внизу + две строки структурированных данных протокола + мятно-зелёный узел верификации (`#5CE6A0`) на фоне фирменного кобальта Valio (`#0A45C4`).
- **Готовый векторный файл для вставки в проект и презентацию:** [kuitti_logo_mark.svg](file:///C:/Users/Administrator/.gemini/antigravity/brain/86060a37-841d-4d51-bd0a-28815e001a5e/kuitti_logo_mark.svg)

> [!NOTE]
> В текущем окружении хакатона облачная растровая модель (`gemini-3-pro-image`) в регионе `eu` отключена на уровне GCP-проекта организаторов, поэтому все ключевые визуалы сгенерированы в чистом масштабируемом векторе (`.svg`) — их можно напрямую импортировать в React/Next.js, Figma и слайды питча без потери качества.

---

## 3. Эстетика «Thermal Brutalism» и цветовая палитра

На хакатоне 90% команд покажут либо белый шаблонный SaaS-дашборд с таблицами, либо тёмно-фиолетовый ИИ-чат. **KUITTI** выделяется тактильной материальностью: **тёплая небелёная «молочная бумага» + угольные чернила термопринтера + кобальт Valio + яркие штампы допуска**.

### Базовые поверхности и чернила
| Токен | Название | HEX | Где используется |
| :--- | :--- | :--- | :--- |
| `--bg-milk-stock` | **Raw Milk Stock** | `#F7F4EC` | Основной фон приложения (тёплый молочно-бумажный оттенок) |
| `--bg-ticket` | **Crisp Receipt** | `#FFFEFA` | Поверхность самого чека сделки (контрастно выделяется на фоне) |
| `--bg-tape` | **Thermal Tape** | `#EFECE2` | Подложка ленты аудита (Audit Trail) и цитат запроса агента |
| `--ink-carbon` | **Carbon Ribbon** | `#11161C` | Основной текст, штрихкоды и верхняя алюминиевая «рельса» (Pass Rail) |
| `--border-perf` | **Perforation Line** | `#CFC8B8` | Пунктирные линии отрыва (`dashed`) и рамки карточек |

### Сигнальные цвета протокола и Guardrails
| Токен | Название | HEX | Смысл в логике челленджа Valio Aimo |
| :--- | :--- | :--- | :--- |
| `--brand-cobalt` | **Aimo Cobalt** | `#0A45C4` | Связь с наследием Valio, крипто-подписи стока, таймер фиксации цены (`TTL`) |
| `--stamp-auto` | **Nordic Pine** | `#008A4B` | Штамп `✓ KUITTI! AUTO-SIGNED` — агент уложился в лимиты без человека + метрики CO₂ |
| `--stamp-hold` | **Pass Lamp Amber** | `#D95D00` | «Тепловая лампа шефа» `⚡ HOLD: SIGN-OFF` — замена товара или превышение порога |
| `--stamp-halt` | **Inspector Red** | `#C81E1E` | Жёсткий стоп `⛔ GUARDRAIL HALT` — нарушение правил по аллергенам или бюджету |

---

## 4. Типографика и фирменные микро-детали

1. **Акцентный гротеск для заголовков и сумм (`--font-display`):**
   - `Space Grotesk` или `Inter` (начертания `800 ExtraBold` / `900 Black`, плотный трекинг `-0.03em`).
   - Используется для номеров чеков (`TICKET #AIMO-0842`), итоговой фиксированной суммы (`€1,468.80`) и названия клиента на рельсе.
2. **Протокольный моноширинный шрифт (`--font-receipt`):**
   - `JetBrains Mono` или `IBM Plex Mono` с обязательным свойством `font-variant-numeric: tabular-nums`.
   - Все артикулы (`SKU#40112`), литраж (`1,000 L`), хеши (`SHA256: 9f84..c21b`), лимиты Guardrails и таймеры резерва (`LOCKED 04:59`) выстраиваются в идеально ровные колонки, как на настоящем чеке.
3. **Гуманистический гротеск для Explainability (`--font-sans`):**
   - `Inter` / `Plus Jakarta Sans` (`400` / `500`) — для человекочитаемых пояснений агента (почему предложена именно эта замена).

### Три узнаваемых приёма, которые делают интерфейс незабываемым
- **Зубчатый край чека (Serrated Edge):** Нижняя кромка карточки заказа оформлена CSS-паттерном `radial-gradient`, имитирующим оторванный на кухне чек.
- **Перфорация между агентом и Valio Aimo:** Левая половина чека (запрос и правила покупателя) и правая половина (подписанный оффер Valio Aimo) разделены пунктирной линией перфорации, поверх которой ложится штамп `KUITTI!`.
- **Штамп вместо обычной кнопки Submit:** Когда решение требует подтверждения шеф-повара (например, частичная замена 1L пакетов на 20L Bag-in-Box), нажатие на кнопку с анимацией «впечатывает» прямоугольный штамп с лёгким наклоном `-2.5deg`.

---

## 5. Необычный концепт интерфейса: «The Pass Rail» (Вместо чат-бота!)

> [!IMPORTANT]
> В условии челленджа прямо сказано: *«This is not about replacing today's e-commerce UI with a chatbot.»* Отказ от чат-окна в пользу диспетчерской рельсы шеф-повара сразу даёт вам сильное преимущество по критериям **Solving user need (20%)** и **Autonomy & controls (20%)**.

![Pass Rail UI Architecture](C:/Users/Administrator/.gemini/antigravity/brain/86060a37-841d-4d51-bd0a-28815e001a5e/kuitti_ui_architecture.svg)

### Как устроен главный экран (3 уровня):
1. **Верхняя панель — Anodized Ticket Rail (Рельса входящих сделок):**
   Горизонтальная тёмная балка, на которую «прищёлкиваются» живые тикеты от внешних агентов кухонь (отели, рестораны, больницы). Цветовой индикатор мгновенно делит поток на 3 корзины:
   - Зелёные (`KUITTI!`) — прошли автоматически, участия человека не требуют;
   - Янтарные (`HOLD`) — ждут 1 клика шефа под «тепловой лампой» (например, выбор `Good / Better / Best` замены);
   - Красные (`GUARD`) — заблокированы жёсткими правилами (например, глютен/аллергены в больничном питании).
2. **Центр — Двусторонний чек сделки (Bilateral Split Ticket):**
   - **Слева (Buyer Agent Side):** исходный запрос + чек-лист активных Guardrails (`[PASS] Spend <= €1,650`, `[SIGN] Packaging format changed`).
   - **Справа (Valio Aimo Verified Side):** разбивка по SKU, обратный отсчёт фиксации цены и резерва (`⏱ Stock Lock TTL 04:59`), карточки ранжирования замен **Best / Better / Good** с расчётом цены за литр и углеродного следа (`kg CO₂e/L` — отсылка к миссии Valio Carbon-Neutral Milk 2035).
3. **Низ чека — Continuous Thermal Audit Tape (Лента объяснимого аудита):**
   Хронологический лог с миллисекундами, понятный и человеку-закупщику, и аудитору Valio Aimo: что запросил агент, какой хеш остатка вернул шлюз, почему сработал guardrail и кто поставил финальный штамп.

---

## 6. Готовые дизайн-токены для кода (`CSS Variables` + `Tailwind`)

Скопируйте этот блок в ваш `globals.css` / `index.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800;900&family=JetBrains+Mono:wght@400;600;700;800&family=Space+Grotesk:wght@700&display=swap');

:root {
  /* Surfaces — Day Shift ("Raw Milk Stock") */
  --kuitti-bg: #F7F4EC;
  --kuitti-ticket: #FFFEFA;
  --kuitti-tape: #EFECE2;
  --kuitti-rail: #11161C;

  /* Ink & Borders */
  --kuitti-ink: #11161C;
  --kuitti-ink-muted: #57606A;
  --kuitti-perf: #CFC8B8;

  /* Signal & Trust Inks */
  --kuitti-cobalt: #0A45C4;       /* Valio Aimo Trust & Signed Hashes */
  --kuitti-cobalt-soft: #EEF5FF;

  --kuitti-pine: #008A4B;         /* KUITTI! Auto-Approved & Carbon 2035 */
  --kuitti-pine-soft: #DDF7E8;

  --kuitti-amber: #D95D00;        /* Hold for Human Chef Sign-Off */
  --kuitti-amber-soft: #FFF0E0;

  --kuitti-red: #C81E1E;          /* Hard Guardrail / Allergen Halt */
  --kuitti-red-soft: #FEF0F0;

  /* Typography */
  --font-display: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  --font-receipt: 'JetBrains Mono', ui-monospace, monospace;
  --font-sans: 'Inter', system-ui, sans-serif;
}

/* Optional Night Shift ("Carbon Pass") */
[data-theme='carbon'] {
  --kuitti-bg: #0D1117;
  --kuitti-ticket: #1A212B;
  --kuitti-tape: #11161C;
  --kuitti-ink: #F7F4EC;
  --kuitti-ink-muted: #9AA4B2;
  --kuitti-perf: #2E3948;
}

/* Monospace Receipt Utility */
.kuitti-mono {
  font-family: var(--font-receipt);
  font-variant-numeric: tabular-nums;
}

/* Serrated Perforated Bottom Ticket Edge */
.kuitti-serrated {
  background-image: radial-gradient(circle at 8px 100%, transparent 6px, var(--kuitti-ticket) 6.5px);
  background-size: 16px 12px;
  background-position: bottom;
  background-repeat: repeat-x;
  padding-bottom: 14px;
}

/* Rubber Verification Stamp */
.kuitti-stamp {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.875rem;
  border: 3px solid currentColor;
  border-radius: 6px;
  font-family: var(--font-receipt);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  transform: rotate(-2.5deg);
}
```

### Расширение для `tailwind.config.ts`

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        kuitti: {
          milk: '#F7F4EC',
          ticket: '#FFFEFA',
          tape: '#EFECE2',
          carbon: '#11161C',
          perf: '#CFC8B8',
          cobalt: '#0A45C4',
          pine: '#008A4B',
          amber: '#D95D00',
          red: '#C81E1E',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        receipt: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
};
```
