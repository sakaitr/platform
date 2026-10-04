export const STATUS_LABEL: Record<string, string> = {
  new: "Yeni",
  contacted: "Görüşüldü",
  qualified: "Nitelikli",
  disqualified: "Uygun değil",
  converted: "Müşteri oldu",
};

export const STATUS_TONE: Record<string, string> = {
  new: "info",
  contacted: "warn",
  qualified: "ok",
  disqualified: "mute",
  converted: "ok",
};

export const TEMPERATURE_LABEL: Record<string, string> = {
  hot: "Sıcak",
  warm: "Ilık",
  cold: "Soğuk",
};

export const TEMPERATURE_TONE: Record<string, string> = { hot: "bad", warm: "warn", cold: "info" };

export const SOURCE_LABEL: Record<string, string> = {
  atricard: "Atricard",
  webform: "Web formu",
  csv: "CSV",
  manual: "Elle",
  api: "API",
};

export const ACTIVITY_LABEL: Record<string, string> = {
  call: "Arama",
  meeting: "Görüşme",
  email: "E-posta",
  note: "Not",
  task: "Görev",
};

export const STATUS_OPTIONS = ["new", "contacted", "qualified", "disqualified"].map((value) => ({
  value,
  label: STATUS_LABEL[value]!,
}));

export const TEMPERATURE_OPTIONS = ["hot", "warm", "cold"].map((value) => ({
  value,
  label: TEMPERATURE_LABEL[value]!,
}));
