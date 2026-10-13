// Windows'ta release derlemesinde ek konsol penceresi açılmaz.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tsdmr_restaurant_lib::run()
}
