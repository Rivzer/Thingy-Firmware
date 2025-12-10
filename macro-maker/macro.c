#include <stdio.h>
#include <string.h>
#include <Windows.h>

#define MAX_KEYS 16

typedef struct {
    const char* name;
    DWORD code;
} KeyMapping;

// Virtual key code mappings
KeyMapping key_map[] = {
    // Letters
    {"a", 0x41}, {"b", 0x42}, {"c", 0x43}, {"d", 0x44}, {"e", 0x45},
    {"f", 0x46}, {"g", 0x47}, {"h", 0x48}, {"i", 0x49}, {"j", 0x4A},
    {"k", 0x4B}, {"l", 0x4C}, {"m", 0x4D}, {"n", 0x4E}, {"o", 0x4F},
    {"p", 0x50}, {"q", 0x51}, {"r", 0x52}, {"s", 0x53}, {"t", 0x54},
    {"u", 0x55}, {"v", 0x56}, {"w", 0x57}, {"x", 0x58}, {"y", 0x59},
    {"z", 0x5A},
    
    // Numbers
    {"0", 0x30}, {"1", 0x31}, {"2", 0x32}, {"3", 0x33}, {"4", 0x34},
    {"5", 0x35}, {"6", 0x36}, {"7", 0x37}, {"8", 0x38}, {"9", 0x39},
    
    // Function keys
    {"f1", VK_F1}, {"f2", VK_F2}, {"f3", VK_F3}, {"f4", VK_F4},
    {"f5", VK_F5}, {"f6", VK_F6}, {"f7", VK_F7}, {"f8", VK_F8},
    {"f9", VK_F9}, {"f10", VK_F10}, {"f11", VK_F11}, {"f12", VK_F12},
    
    // Modifiers
    {"ctrl", VK_CONTROL}, {"shift", VK_SHIFT}, {"alt", VK_MENU},
    {"win", VK_LWIN}, {"lwin", VK_LWIN}, {"rwin", VK_RWIN},
    {"lctrl", VK_LCONTROL}, {"rctrl", VK_RCONTROL},
    {"lshift", VK_LSHIFT}, {"rshift", VK_RSHIFT},
    {"lalt", VK_LMENU}, {"ralt", VK_RMENU},
    
    // Special keys
    {"space", VK_SPACE}, {"enter", VK_RETURN}, {"esc", VK_ESCAPE},
    {"tab", VK_TAB}, {"backspace", VK_BACK}, {"delete", VK_DELETE},
    {"insert", VK_INSERT}, {"home", VK_HOME}, {"end", VK_END},
    {"pageup", VK_PRIOR}, {"pagedown", VK_NEXT},
    {"up", VK_UP}, {"down", VK_DOWN}, {"left", VK_LEFT}, {"right", VK_RIGHT},
    
    // Punctuation
    {"minus", VK_OEM_MINUS}, {"plus", VK_OEM_PLUS},
    {"comma", VK_OEM_COMMA}, {"period", VK_OEM_PERIOD},
    {"slash", VK_OEM_2}, {"backslash", VK_OEM_5},
    {"semicolon", VK_OEM_1}, {"quote", VK_OEM_7},
    {"leftbracket", VK_OEM_4}, {"rightbracket", VK_OEM_6},
    {"backtick", VK_OEM_3},
    
    // Media keys
    {"volumeup", VK_VOLUME_UP}, {"volumedown", VK_VOLUME_DOWN},
    {"mute", VK_VOLUME_MUTE}, {"play", VK_MEDIA_PLAY_PAUSE},
    {"stop", VK_MEDIA_STOP}, {"next", VK_MEDIA_NEXT_TRACK},
    {"prev", VK_MEDIA_PREV_TRACK},
    
    {NULL, 0}
};

DWORD keys[MAX_KEYS];
INPUT inputs[MAX_KEYS];
int key_count = 0;

DWORD get_key_code(const char* key_name) {
    // Check if it's a number (for backward compatibility)
    if (key_name[0] >= '0' && key_name[0] <= '9') {
        char* endptr;
        long val = strtol(key_name, &endptr, 10);
        if (*endptr == '\0') {
            return (DWORD)val;
        }
    }
    
    // Look up in key map
    for (int i = 0; key_map[i].name != NULL; i++) {
        if (_stricmp(key_name, key_map[i].name) == 0) {
            return key_map[i].code;
        }
    }
    
    return 0;
}

void simulate_key_press() {
    for (int i = 0; i < key_count; i++) {
        inputs[i].type = INPUT_KEYBOARD;
        inputs[i].ki.wVk = keys[i];
        inputs[i].ki.wScan = MapVirtualKey(keys[i], MAPVK_VK_TO_VSC);
        inputs[i].ki.time = 0;
        inputs[i].ki.dwExtraInfo = 0;
    }

    for (int i = 0; i < key_count; i++) {
        inputs[i].ki.dwFlags = 0;
        SendInput(1, &inputs[i], sizeof(INPUT));
    }

    Sleep(1);

    for (int i = key_count - 1; i >= 0; i--) {
        inputs[i].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(1, &inputs[i], sizeof(INPUT));
    }
}

int main(int argc, const char* argv[]) {
    if (argc < 2 || argc > MAX_KEYS + 1) {
        return 1;
    }

    for (int i = 1; i < argc; i++) {
        DWORD code = get_key_code(argv[i]);
        if (code == 0) {
            return 1; // Invalid key
        }
        keys[key_count++] = code;
    }

    simulate_key_press();

    return 0;
}