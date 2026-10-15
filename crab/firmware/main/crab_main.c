/* SPDX-License-Identifier: MIT. Standalone client, no Muse service or
 * credentials. */
#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/base64.h"
#include "muse_audio.h"
#include "muse_board.h"
#include "muse_pixel.h"
#include "muse_state.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define MAX_RECORD (16000 * 20)
#define LINE_CAP 16384
const muse_board_t *muse_board;
static char ssid[33], password[65], url[256], token[129], device_id[32];
static atomic_bool wifi_up, held, busy, cancelled;
static atomic_uint page;
static atomic_uint record_ms;
static atomic_bool audio_test;
static atomic_bool sleep_test;
static TaskHandle_t voice_handle;
static portMUX_TYPE text_lock = portMUX_INITIALIZER_UNLOCKED;
static char reply[4096];
static uint32_t reply_version;
static lv_obj_t *label, *status, *canvas;
static uint16_t pixels[128 * 128];
static lv_font_t caption_font;
LV_FONT_DECLARE(muse_font_cjk_16);
int muse_settings_volume(void) { return 45; }
int muse_settings_mic_gain(void) { return 36; }
bool muse_settings_speaker_on(void) { return true; }
static void text_set(const char *s) {
  portENTER_CRITICAL(&text_lock);
  strlcpy(reply, s, sizeof(reply));
  reply_version++;
  portEXIT_CRITICAL(&text_lock);
}
static void text_append(const char *s) {
  portENTER_CRITICAL(&text_lock);
  strlcat(reply, s, sizeof(reply));
  reply_version++;
  portEXIT_CRITICAL(&text_lock);
}
static void fail(const char *s) {
  text_set(s);
  muse_state_set_mode(MUSE_MODE_ERROR);
}
static void load_config(void) {
  nvs_handle_t h;
  if (nvs_open("crab", NVS_READONLY, &h) != ESP_OK)
    return;
  size_t n = sizeof(ssid);
  nvs_get_str(h, "ssid", ssid, &n);
  n = sizeof(password);
  nvs_get_str(h, "password", password, &n);
  n = sizeof(url);
  nvs_get_str(h, "url", url, &n);
  n = sizeof(token);
  nvs_get_str(h, "token", token, &n);
  nvs_close(h);
}
static bool begin_recording(unsigned ms) {
  bool expected = false;
  if (!atomic_load(&wifi_up) ||
      !atomic_compare_exchange_strong(&busy, &expected, true))
    return false;
  atomic_store(&cancelled, false);
  atomic_store(&record_ms, ms);
  atomic_store(&held, true);
  muse_state_poke();
  xTaskNotifyGive(voice_handle);
  return true;
}
static void serial_task(void *unused) {
  (void)unused;
  char line[1024];
  size_t used = 0;
  bool overflow = false;
  for (;;) {
    char c;
    if (usb_serial_jtag_read_bytes(&c, 1, pdMS_TO_TICKS(100)) != 1)
      continue;
    if (c == '\r')
      continue;
    if (c != '\n') {
      if (used < sizeof(line) - 1 && !overflow)
        line[used++] = c;
      else
        overflow = true;
      continue;
    }
    line[used] = 0;
    used = 0;
    if (overflow) {
      overflow = false;
      puts("@crab {\"ok\":false,\"error\":\"line too long\"}");
      continue;
    }
    cJSON *j = cJSON_Parse(line);
    memset(line, 0, sizeof(line));
    if (!j) {
      puts("@crab {\"ok\":false,\"error\":\"invalid JSON\"}");
      continue;
    }
    const cJSON *cmd = cJSON_GetObjectItemCaseSensitive(j, "command");
    if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "status")) {
      cJSON *report = cJSON_CreateObject();
      cJSON_AddStringToObject(report, "board", "M5Stack StickS3");
      cJSON_AddBoolToObject(report, "configured",
                            ssid[0] && url[0] && token[0]);
      cJSON_AddBoolToObject(report, "wifi", atomic_load(&wifi_up));
      cJSON_AddBoolToObject(report, "busy", atomic_load(&busy));
      cJSON_AddNumberToObject(report, "uptime_ms", esp_timer_get_time() / 1000);
      cJSON_AddNumberToObject(report, "reset_reason", esp_reset_reason());
      cJSON_AddNumberToObject(report, "free_internal",
                              heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
      cJSON_AddNumberToObject(report, "free_psram",
                              heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
      float elapsed;
      cJSON_AddNumberToObject(report, "mode", muse_state_mode(&elapsed));
      muse_power_t power = muse_state_power();
      cJSON_AddNumberToObject(report, "battery", power.battery_pct);
      cJSON_AddBoolToObject(report, "usb", power.usb);
      char caption[sizeof(reply)];
      portENTER_CRITICAL(&text_lock);
      strlcpy(caption, reply, sizeof(caption));
      portEXIT_CRITICAL(&text_lock);
      cJSON_AddStringToObject(report, "caption", caption);
      char *encoded = cJSON_PrintUnformatted(report);
      if (encoded) {
        printf("@crab %s\n", encoded);
        free(encoded);
      }
      cJSON_Delete(report);
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "record")) {
      const cJSON *duration =
          cJSON_GetObjectItemCaseSensitive(j, "milliseconds");
      if (!cJSON_IsNumber(duration) || duration->valueint < 200 ||
          duration->valueint > 20000 || !begin_recording(duration->valueint))
        puts("@crab {\"ok\":false,\"error\":\"busy, offline or invalid "
             "duration\"}");
      else
        puts("@crab {\"ok\":true}");
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "cancel")) {
      atomic_store(&cancelled, true);
      atomic_store(&held, false);
      puts("@crab {\"ok\":true}");
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "sleep_test")) {
      bool expected = false;
      if (atomic_compare_exchange_strong(&busy, &expected, true)) {
        atomic_store(&sleep_test, true);
        puts("@crab {\"ok\":true,\"wake_after_ms\":3000}");
      } else
        puts("@crab {\"ok\":false,\"error\":\"busy\"}");
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "audio_test")) {
      bool expected = false;
      if (atomic_compare_exchange_strong(&busy, &expected, true)) {
        atomic_store(&audio_test, true);
        xTaskNotifyGive(voice_handle);
        puts("@crab {\"ok\":true}");
      } else
        puts("@crab {\"ok\":false,\"error\":\"busy\"}");
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "reconnect")) {
      if (atomic_load(&busy))
        puts("@crab {\"ok\":false,\"error\":\"busy\"}");
      else {
        esp_wifi_disconnect();
        puts("@crab {\"ok\":true}");
      }
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "pet")) {
      muse_state_make_happy();
      atomic_fetch_add(&page, 1);
      puts("@crab {\"ok\":true}");
    } else if (cJSON_IsString(cmd) && !strcmp(cmd->valuestring, "configure")) {
      const cJSON *s = cJSON_GetObjectItemCaseSensitive(j, "ssid"),
                  *p = cJSON_GetObjectItemCaseSensitive(j, "password"),
                  *u = cJSON_GetObjectItemCaseSensitive(j, "url"),
                  *t = cJSON_GetObjectItemCaseSensitive(j, "token");
      if (!cJSON_IsString(s) || !strlen(s->valuestring) ||
          strlen(s->valuestring) > 32 || !cJSON_IsString(p) ||
          strlen(p->valuestring) > 64 || !cJSON_IsString(u) ||
          strlen(u->valuestring) > 200 ||
          strncmp(u->valuestring, "http://", 7) || !cJSON_IsString(t) ||
          strlen(t->valuestring) < 32 || strlen(t->valuestring) > 128 ||
          strchr(t->valuestring, '\r') || strchr(t->valuestring, '\n')) {
        puts("@crab {\"ok\":false,\"error\":\"invalid configuration; use LAN "
             "http URL\"}");
      } else {
        nvs_handle_t h;
        esp_err_t e = nvs_open("crab", NVS_READWRITE, &h);
        if (e == ESP_OK) {
          e = nvs_set_str(h, "ssid", s->valuestring);
          if (e == ESP_OK)
            e = nvs_set_str(h, "password", p->valuestring);
          if (e == ESP_OK)
            e = nvs_set_str(h, "url", u->valuestring);
          if (e == ESP_OK)
            e = nvs_set_str(h, "token", t->valuestring);
          if (e == ESP_OK)
            e = nvs_commit(h);
          nvs_close(h);
        }
        if (e == ESP_OK) {
          puts("@crab {\"ok\":true,\"restart\":true}");
          fflush(stdout);
          vTaskDelay(pdMS_TO_TICKS(100));
          esp_restart();
        } else
          puts("@crab {\"ok\":false,\"error\":\"NVS write failed\"}");
      }
    } else
      puts("@crab {\"ok\":false,\"error\":\"unknown command\"}");
    cJSON_Delete(j);
  }
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t id,
                       void *data) {
  (void)arg;
  (void)data;
  if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    atomic_store(&wifi_up, true);
    if (!atomic_load(&busy))
      text_set("按住正面按钮说话");
  }
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    atomic_store(&wifi_up, false);
    esp_wifi_connect();
  }
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START)
    esp_wifi_connect();
}
static void start_wifi(void) {
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&init));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                             wifi_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                             wifi_event, NULL));
  wifi_config_t cfg = {0};
  strlcpy((char *)cfg.sta.ssid, ssid, sizeof(cfg.sta.ssid));
  strlcpy((char *)cfg.sta.password, password, sizeof(cfg.sta.password));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
  ESP_ERROR_CHECK(esp_wifi_start());
  esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
}
static void le32(uint8_t *b, uint32_t n) {
  b[0] = n;
  b[1] = n >> 8;
  b[2] = n >> 16;
  b[3] = n >> 24;
}
static void wav_header(uint8_t *b, size_t bytes) {
  memset(b, 0, 44);
  memcpy(b, "RIFF", 4);
  le32(b + 4, bytes + 36);
  memcpy(b + 8, "WAVEfmt ", 8);
  le32(b + 16, 16);
  b[20] = 1;
  b[22] = 1;
  le32(b + 24, 16000);
  le32(b + 28, 32000);
  b[32] = 2;
  b[34] = 16;
  memcpy(b + 36, "data", 4);
  le32(b + 40, bytes);
}
static bool handle_line(char *line, bool *done) {
  static bool first_delta;
  cJSON *j = cJSON_Parse(line);
  if (!j)
    return false;
  cJSON *type = cJSON_GetObjectItemCaseSensitive(j, "type"),
        *text = cJSON_GetObjectItemCaseSensitive(j, "text");
  bool ok = cJSON_IsString(type);
  if (ok && !strcmp(type->valuestring, "accepted"))
    first_delta = true;
  if (ok && !strcmp(type->valuestring, "text_delta") && cJSON_IsString(text)) {
    if (first_delta) {
      text_set("");
      first_delta = false;
    }
    text_append(text->valuestring);
  }
  if (ok && !strcmp(type->valuestring, "transcript") && cJSON_IsString(text))
    text_set(text->valuestring);
  if (ok && !strcmp(type->valuestring, "reply") && cJSON_IsString(text)) {
    text_set(text->valuestring);
    atomic_store(&page, 0);
  }
  if (ok && !strcmp(type->valuestring, "audio")) {
    cJSON *pcm = cJSON_GetObjectItemCaseSensitive(j, "pcm"),
          *rate = cJSON_GetObjectItemCaseSensitive(j, "rate");
    int16_t decoded[3200];
    size_t bytes = 0;
    ok = cJSON_IsString(pcm) && cJSON_IsNumber(rate) &&
         rate->valueint == 16000 &&
         mbedtls_base64_decode((uint8_t *)decoded, sizeof(decoded), &bytes,
                               (unsigned char *)pcm->valuestring,
                               strlen(pcm->valuestring)) == 0 &&
         bytes % 2 == 0;
    if (ok) {
      muse_state_set_mode(MUSE_MODE_SPEAKING);
      for (size_t at = 0; at < bytes / 2 && !atomic_load(&cancelled);
           at += MUSE_AUDIO_CHUNK) {
        size_t frames = bytes / 2 - at;
        if (frames > MUSE_AUDIO_CHUNK)
          frames = MUSE_AUDIO_CHUNK;
        muse_state_set_level(muse_audio_level(decoded + at, frames));
        if (muse_audio_write(decoded + at, frames) != ESP_OK) {
          ok = false;
          break;
        }
      }
    }
  }
  if (ok && !strcmp(type->valuestring, "done"))
    *done = true;
  if (ok && !strcmp(type->valuestring, "error")) {
    fail(cJSON_IsString(text) ? text->valuestring : "电脑服务错误");
    ok = false;
  }
  cJSON_Delete(j);
  return ok;
}
static void send_turn(uint8_t *wav, size_t bytes) {
  char endpoint[288], auth[144];
  snprintf(endpoint, sizeof(endpoint), "%s/v1/turn", url);
  snprintf(auth, sizeof(auth), "Bearer %s", token);
  esp_http_client_config_t cfg = {.url = endpoint,
                                  .timeout_ms = 10000,
                                  .buffer_size = 2048,
                                  .keep_alive_enable = false};
  esp_http_client_handle_t client = esp_http_client_init(&cfg);
  if (!client) {
    fail("无法创建连接");
    return;
  }
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Authorization", auth);
  esp_http_client_set_header(client, "X-Device-ID", device_id);
  esp_http_client_set_header(client, "Content-Type", "audio/wav");
  char *line = heap_caps_malloc(LINE_CAP, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  size_t used = 0;
  bool done = false, ok = line != NULL;
  const char *stage = "memory";
  int result = 0;
  size_t received = 0;
  if (ok) {
    stage = "connect";
    result = esp_http_client_open(client, bytes);
    ok = result == ESP_OK;
  }
  stage = ok ? "upload" : stage;
  for (size_t at = 0; ok && at < bytes && !atomic_load(&cancelled);) {
    int n = esp_http_client_write(client, (const char *)wav + at,
                                  bytes - at > 4096 ? 4096 : bytes - at);
    if (n <= 0) {
      result = n;
      ok = false;
    } else
      at += n;
  }
  if (ok && !atomic_load(&cancelled)) {
    stage = "headers";
    // Allow Wi-Fi retransmissions during connection/upload/header exchange.
    // Reads below use a shorter timeout so cancellation remains responsive.
    result = esp_http_client_fetch_headers(client);
    ok = result >= 0 && esp_http_client_get_status_code(client) == 200;
  }
  esp_http_client_set_timeout_ms(client, 1000);
  if (ok)
    stage = "response";
  int64_t deadline = esp_timer_get_time() + 120000000;
  while (ok && !done && !atomic_load(&cancelled) &&
         esp_timer_get_time() < deadline) {
    char buf[1024];
    int n = esp_http_client_read(client, buf, sizeof(buf));
    if (n == -ESP_ERR_HTTP_EAGAIN)
      continue;
    if (n < 0) {
      result = n;
      ok = false;
      break;
    }
    received += n;
    if (n == 0) {
      if (esp_http_client_is_complete_data_received(client))
        break;
      continue;
    }
    for (int i = 0; i < n && ok && !done; i++) {
      if (buf[i] == '\n') {
        line[used] = 0;
        ok = handle_line(line, &done);
        used = 0;
      } else if (used < LINE_CAP - 1)
        line[used++] = buf[i];
      else
        ok = false;
    }
  }
  ESP_LOGI("crab", "turn stage=%s result=%d status=%d received=%u done=%d cancelled=%d",
           stage, result, esp_http_client_get_status_code(client),
           (unsigned)received, done, atomic_load(&cancelled));
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
  free(line);
  if (atomic_load(&cancelled))
    text_set("已取消，再按一次说话");
  else if (!ok || !done) {
    float elapsed;
    if (muse_state_mode(&elapsed) != MUSE_MODE_ERROR)
      fail("连接失败或超时，请检查电脑服务");
  }
}
static void voice_task(void *unused) {
  (void)unused;
  uint8_t *wav = heap_caps_malloc(44 + MAX_RECORD * 2,
                                  MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!wav) {
    fail("录音内存不足");
    vTaskDelete(NULL);
    return;
  }
  int16_t buf[MUSE_AUDIO_CHUNK];
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    atomic_store(&page, 0);
    muse_audio_power(true);
    if (atomic_exchange(&audio_test, false)) {
      muse_state_set_mode(MUSE_MODE_LISTENING);
      text_set("音频硬件测试…");
      muse_audio_selftest();
      muse_audio_loopback_test(35);
      muse_audio_power(false);
      muse_state_set_mode(MUSE_MODE_IDLE);
      text_set("音频测试完成，详情见 USB 日志");
      atomic_store(&busy, false);
      continue;
    }
    muse_state_set_mode(MUSE_MODE_LISTENING);
    text_set("正在听…松开发送");
    size_t frames = 0;
    unsigned timed_ms = atomic_load(&record_ms);
    int64_t record_until = esp_timer_get_time() + (int64_t)timed_ms * 1000;
    while (atomic_load(&held) && !atomic_load(&cancelled) &&
           frames < MAX_RECORD &&
           (!timed_ms || esp_timer_get_time() < record_until)) {
      if (muse_audio_read(buf, MUSE_AUDIO_CHUNK) != ESP_OK) {
        atomic_store(&cancelled, true);
        fail("录音失败");
        break;
      }
      memcpy(wav + 44 + frames * 2, buf, sizeof(buf));
      frames += MUSE_AUDIO_CHUNK;
      muse_state_set_level(muse_audio_level(buf, MUSE_AUDIO_CHUNK));
    }
    if (!atomic_load(&cancelled) && frames >= 1600) {
      wav_header(wav, frames * 2);
      muse_state_set_mode(MUSE_MODE_THINKING);
      text_set("电脑正在处理…");
      send_turn(wav, 44 + frames * 2);
    } else if (!atomic_load(&cancelled))
      text_set("按住按钮说话，松开发送");
    muse_state_set_level(0);
    muse_audio_power(false);
    float elapsed;
    if (muse_state_mode(&elapsed) != MUSE_MODE_ERROR)
      muse_state_set_mode(MUSE_MODE_IDLE);
    atomic_store(&busy, false);
  }
}
static void input_task(void *unused) {
  (void)unused;
  int64_t side_down = 0;
  bool side_long = false;
  for (;;) {
    if (atomic_exchange(&sleep_test, false)) {
      muse_state_set_mode(MUSE_MODE_OFF);
      text_set("休眠测试，三秒后唤醒");
      vTaskDelay(pdMS_TO_TICKS(500));
      ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(3000000));
      muse_board->power_off();
      atomic_store(&busy, false);
    }
    unsigned b = muse_board->poll_buttons();
    if (!atomic_load(&busy) && muse_state_on_battery() &&
        muse_state_idle_secs() > 120) {
      muse_state_set_mode(MUSE_MODE_OFF);
      vTaskDelay(pdMS_TO_TICKS(500));
      muse_board->power_off();
    }
    if (b) {
      muse_state_poke();
      muse_state_set_asleep(false);
      muse_board->set_brightness(65);
    }
    if (b & MUSE_BTN_TALK_PRESS) {
      if (atomic_load(&busy)) {
        atomic_store(&cancelled, true);
        text_set("正在取消…");
      } else if (!ssid[0] || !url[0] || !token[0])
        fail("先用 USB 配置网络和服务地址");
      else if (!atomic_load(&wifi_up))
        fail("Wi-Fi 尚未连接");
      else {
        begin_recording(0);
      }
    }
    if (b & MUSE_BTN_TALK_RELEASE)
      atomic_store(&held, false);
    if (b & MUSE_BTN_AUX_PRESS) {
      side_down = esp_timer_get_time();
      side_long = false;
    }
    if (side_down && !side_long && esp_timer_get_time() - side_down > 3000000) {
      side_long = true;
      if (!atomic_load(&busy)) {
        muse_state_set_mode(MUSE_MODE_OFF);
        vTaskDelay(pdMS_TO_TICKS(500));
        muse_board->power_off();
      }
    }
    if (b & MUSE_BTN_AUX_RELEASE) {
      if (!side_long) {
        atomic_fetch_add(&page, 1);
        muse_state_make_happy();
      }
      side_down = 0;
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
static void render(lv_timer_t *timer) {
  (void)timer;
  float mode_t;
  muse_mode_t mode = muse_state_mode(&mode_t);
  muse_pose_t pose = {.mode = mode,
                      .mode_t = mode_t,
                      .t = esp_timer_get_time() / 1e6f,
                      .level = muse_state_level(),
                      .happy = muse_state_happiness()};
  muse_pixel_render(&pose);
  muse_pixel_scale(pixels, 128, 0, 127, 0, 127);
  lv_obj_invalidate(canvas);
  static uint32_t seen = UINT32_MAX;
  static unsigned previous = UINT32_MAX;
  char full[4096];
  uint32_t version;
  portENTER_CRITICAL(&text_lock);
  strlcpy(full, reply, sizeof(full));
  version = reply_version;
  portEXIT_CRITICAL(&text_lock);
  unsigned selected = atomic_load(&page);
  if (version != seen || selected != previous) {
    const char *starts[130];
    unsigned pages = 0, chars = 0;
    starts[pages++] = full;
    for (char *s = full; *s; s++)
      if (((unsigned char)*s & 0xc0) != 0x80) {
        if (chars == 32) {
          if (pages < 130)
            starts[pages++] = s;
          chars = 0;
        }
        chars++;
      }
    unsigned chosen = selected % pages;
    const char *end =
        chosen + 1 < pages ? starts[chosen + 1] : full + strlen(full);
    char display[160];
    size_t bytes = end - starts[chosen];
    if (bytes >= sizeof(display))
      bytes = sizeof(display) - 1;
    memcpy(display, starts[chosen], bytes);
    display[bytes] = 0;
    lv_label_set_text(label, display);
    seen = version;
    previous = selected;
  }
  static int64_t next_power;
  if (esp_timer_get_time() > next_power) {
    muse_power_t p = {0};
    if (muse_board->read_power(&p) == ESP_OK)
      muse_state_set_power(&p);
    next_power = esp_timer_get_time() + 5000000;
  }
  muse_power_t p = muse_state_power();
  char top[64];
  snprintf(top, sizeof(top), "CRAB  %s  %d%%",
           atomic_load(&wifi_up) ? "WiFi" : "offline", p.battery_pct);
  lv_label_set_text(status, top);
  if (!atomic_load(&busy) && muse_state_on_battery() &&
      muse_state_idle_secs() > 30 && !muse_state_asleep()) {
    muse_board->set_brightness(0);
    muse_state_set_asleep(true);
  }
}
void app_main(void) {
  ESP_LOGI("crab", "Crab standalone starting");
  ESP_ERROR_CHECK(nvs_flash_init());
  load_config();
  uint8_t mac[6];
  ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_STA));
  snprintf(device_id, sizeof(device_id), "crab-%02x%02x%02x", mac[3], mac[4],
           mac[5]);
  usb_serial_jtag_driver_config_t serial = {.tx_buffer_size = 2048,
                                            .rx_buffer_size = 2048};
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&serial));
  usb_serial_jtag_vfs_use_driver();
  muse_board = muse_board_get();
  muse_state_init();
  ESP_ERROR_CHECK(muse_board->init());
  lv_indev_t *touch = NULL;
  lv_display_t *disp = muse_board->display_start(&touch);
  if (!disp)
    abort();
  muse_board->display_lock(-1);
  lv_obj_t *root = lv_display_get_screen_active(disp);
  lv_obj_set_style_bg_color(root, lv_color_black(), 0);
  status = lv_label_create(root);
  lv_obj_set_style_text_font(status, &lv_font_montserrat_12, 0);
  lv_obj_set_style_text_color(status, lv_color_hex(0xffac6d), 0);
  lv_obj_align(status, LV_ALIGN_TOP_MID, 0, 3);
  canvas = lv_canvas_create(root);
  lv_canvas_set_buffer(canvas, pixels, 128, 128, LV_COLOR_FORMAT_RGB565);
  lv_obj_align(canvas, LV_ALIGN_TOP_MID, 0, 20);
  muse_pixel_set_size(128);
  caption_font = lv_font_montserrat_14;
  caption_font.fallback = &muse_font_cjk_16;
  label = lv_label_create(root);
  lv_obj_set_width(label, 128);
  lv_obj_set_style_text_font(label, &caption_font, 0);
  lv_obj_set_style_text_color(label, lv_color_hex(0xfff2ce), 0);
  lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
  lv_obj_align(label, LV_ALIGN_TOP_MID, 0, 150);
  lv_timer_create(render, 40, NULL);
  muse_board->display_unlock();
  muse_board->set_brightness(65);
  ESP_ERROR_CHECK(muse_audio_init(45, 36));
  muse_audio_power(false);
  if (xTaskCreate(voice_task, "crab_voice", 16384, NULL, 5, &voice_handle) !=
      pdPASS)
    abort();
  if (xTaskCreate(input_task, "crab_input", 4096, NULL, 6, NULL) != pdPASS)
    abort();
  if (xTaskCreate(serial_task, "crab_serial", 10240, NULL, 3, NULL) != pdPASS)
    abort();
  if (ssid[0] && url[0] && token[0]) {
    text_set("正在连接 Wi-Fi…");
    start_wifi();
  } else
    text_set("请通过 USB 配置网络和电脑服务");
  vTaskDelay(pdMS_TO_TICKS(1200));
  muse_state_set_mode(MUSE_MODE_IDLE);
}
