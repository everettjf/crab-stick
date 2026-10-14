# Reuse only the board, audio and pixel interfaces; no Muse networking or avatar.
set(upstream "${CMAKE_CURRENT_LIST_DIR}/../../../esp32/components/muse")
idf_component_register(SRCS "crab_main.c"
  "${upstream}/boards/board_m5stack_sticks3.c"
  "${upstream}/muse_board.c" "${upstream}/muse_audio.c"
  "${upstream}/muse_state.c" "${upstream}/muse_text.c"
  "${upstream}/fonts/muse_font_cjk_16.c"
  "../../avatar/crab_pixel.c"
  INCLUDE_DIRS "." "${upstream}"
  REQUIRES esp_driver_gpio esp_driver_i2c esp_driver_i2s esp_driver_spi esp_driver_ledc
  esp_lcd esp_timer esp_wifi esp_event esp_netif esp_http_client nvs_flash esp_psram mbedtls esp_driver_usb_serial_jtag vfs)
