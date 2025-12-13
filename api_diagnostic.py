#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Утилита для пошаговой проверки доступности OpenAI GPT и Google Gemini.

Особенности:
- Поддерживает проверку одного ключа или списка ключей для каждого провайдера.
- Автоматически пытается определить тип ключа по префиксу, если он передан позиционно.
- Показывает детализированные статусы на каждом этапе (подключение, авторизация, тестовый запрос).
- Поддерживает отдельную проверку GET-запроса Gemini через параметр --gemini-get-url.

Примеры запуска:
- python3 api_diagnostic.py sk-xxx AIzaSyyyy
- python3 api_diagnostic.py --openai sk-xxx sk-yyy --gemini AIzaSy1 AIzaSy2
- python3 api_diagnostic.py --openai sk-xxx --skip-ip-check
- python3 api_diagnostic.py --gemini AIzaSyExample --gemini-get-url models/gemini-pro
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, List, Optional, Tuple

import requests


class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


def print_header(text: str) -> None:
    line = "═" * 70
    print(f"\n{Colors.BOLD}{Colors.CYAN}{line}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{text.center(70)}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{line}{Colors.RESET}\n")


def print_step(number: int, text: str) -> None:
    print(f"{Colors.BOLD}{Colors.BLUE}[Шаг {number}]{Colors.RESET} {text}")


def print_success(text: str) -> None:
    print(f"{Colors.GREEN}✅ {text}{Colors.RESET}")


def print_error(text: str) -> None:
    print(f"{Colors.RED}❌ {text}{Colors.RESET}")


def print_info(key: str, value: str) -> None:
    print(f"   {Colors.YELLOW}{key}:{Colors.RESET} {value}")


def mask_key(key: str, visible: int = 6) -> str:
    if len(key) <= visible * 2:
        return key
    return f"{key[:visible]}…{key[-visible:]}"


@dataclass
class KeySet:
    openai_keys: List[str]
    gemini_keys: List[str]


def detect_vendor_for_key(key: str) -> Optional[str]:
    lowered = key.lower()
    if lowered.startswith(("sk-", "sk-proj-")):
        return "openai"
    if lowered.startswith("AIza".lower()):
        return "gemini"
    return None


def unique_preserve_order(keys: Iterable[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for key in keys:
        if key not in seen:
            ordered.append(key)
            seen.add(key)
    return ordered


def parse_args(argv: List[str]) -> Tuple[KeySet, bool, Optional[str]]:
    parser = argparse.ArgumentParser(description="Детальная проверка OpenAI и Gemini API")
    parser.add_argument("keys", nargs="*", help="Ключи в произвольном порядке (определяются автоматически)")
    parser.add_argument("--openai", "-o", dest="openai_keys", nargs="+", help="Ключи OpenAI", default=[])
    parser.add_argument("--gemini", "-g", dest="gemini_keys", nargs="+", help="Ключи Gemini", default=[])
    parser.add_argument("--skip-ip-check", action="store_true", help="Пропустить определение IP и географии")
    parser.add_argument(
        "--gemini-get-url",
        help=(
            "Выполнить GET-запрос к указанному пути API Gemini (например, 'models/gemini-pro'). "
            "Будет использован только первый ключ Gemini из переданных."
        ),
        default=None,
    )
    args = parser.parse_args(argv)

    openai_keys = list(args.openai_keys)
    gemini_keys = list(args.gemini_keys)

    for key in args.keys:
        vendor = detect_vendor_for_key(key)
        if vendor == "openai":
            openai_keys.append(key)
        elif vendor == "gemini":
            gemini_keys.append(key)
        else:
            print_info("⚠️  Не удалось определить", mask_key(key))
            openai_keys.append(key)  # Default to OpenAI if unknown

    return (
        KeySet(unique_preserve_order(openai_keys), unique_preserve_order(gemini_keys)),
        args.skip_ip_check,
        args.gemini_get_url,
    )


def check_ip_location(skip: bool = False) -> Optional[dict]:
    if skip:
        print_header("ПРОВЕРКА ВАШЕГО МЕСТОПОЛОЖЕНИЯ (ПРОПУЩЕНО)")
        return None

    print_header("ПРОВЕРКА ВАШЕГО МЕСТОПОЛОЖЕНИЯ")
    print_step(1, "Определяю ваш IP адрес и географическое положение...")
    try:
        response = requests.get("https://ipapi.co/json/", timeout=10)
        if response.status_code == 200:
            data = response.json()
            print_success("Информация получена успешно!")
            print_info("IP адрес", data.get("ip", "Неизвестно"))
            print_info("Страна", f"{data.get('country_name', 'Неизвестно')} ({data.get('country', 'N/A')})")
            print_info("Город", data.get("city", "Неизвестно"))
            print_info("Регион", data.get("region", "Неизвестно"))
            print_info("Провайдер", data.get("org", "Неизвестно"))
            print_info("Часовой пояс", data.get("timezone", "Неизвестно"))
            return data

        print_error(f"Не удалось получить информацию. Код: {response.status_code}")
        return None
    except Exception as exc:  # noqa: BLE001
        print_error(f"Ошибка: {exc}")
        return None


def test_openai_api(api_key: str) -> bool:
    print_header(f"ТЕСТИРОВАНИЕ OPENAI GPT API ({mask_key(api_key)})")

    print_step(1, "Проверяю доступность сервера OpenAI...")
    try:
        response = requests.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
    except Exception as exc:  # noqa: BLE001
        print_error(f"Не удалось подключиться к серверу: {exc}")
        return False

    if response.status_code != 200:
        if response.status_code == 401:
            print_error("API ключ неверный или недействительный")
        elif response.status_code == 403:
            print_error("Доступ запрещен - возможна блокировка по IP")
        else:
            print_error(f"Сервер вернул код {response.status_code}")
            print_info("Ответ сервера", response.text[:200])
        return False

    print_success("Сервер OpenAI доступен!")
    print_info("Статус код", "200 OK")
    print_info("Время ответа", f"{response.elapsed.total_seconds():.2f} секунд")

    print_step(2, "Получаю список доступных моделей...")
    models: List[str] = []
    try:
        data = response.json()
        models = [model["id"] for model in data.get("data", []) if "gpt" in model.get("id", "").lower()]
        print_success(f"Доступно {len(models)} GPT моделей")
        if models:
            print_info("Примеры моделей", ", ".join(sorted(models)[:5]))
    except Exception as exc:  # noqa: BLE001
        print_error(f"Не удалось получить список моделей: {exc}")

    print_step(3, "Отправляю тестовое сообщение к GPT-3.5...")
    payload = {
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "Ответь одним словом: работает ли API?"}],
        "max_tokens": 10,
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}

    try:
        chat_response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            json=payload,
            headers=headers,
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001
        print_error(f"Ошибка при отправке запроса: {exc}")
        return False

    if chat_response.status_code != 200:
        print_error(f"Ошибка при запросе. Код: {chat_response.status_code}")
        print_info("Детали ошибки", chat_response.text[:300])
        return False

    try:
        data = chat_response.json()
        message = data["choices"][0]["message"]["content"]
        used_tokens = data.get("usage", {}).get("total_tokens")
    except Exception as exc:  # noqa: BLE001
        print_error(f"Не удалось разобрать ответ модели: {exc}")
        return False

    print_success("Получен ответ от GPT!")
    print_info("Ответ модели", f'"{message}"')
    if used_tokens is not None:
        print_info("Использовано токенов", str(used_tokens))
    print_info("Модель", data.get("model", "Неизвестно"))
    print_info("Время обработки", f"{chat_response.elapsed.total_seconds():.2f} сек")

    print(f"\n{Colors.BOLD}{Colors.GREEN}{'═' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}РЕЗУЛЬТАТ: OpenAI API функционирует!{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Сервер доступен{Colors.RESET}")
    print(f"{Colors.GREEN}✓ API ключ работает{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Модели доступны{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Запросы обрабатываются корректно{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Географических ограничений НЕ ОБНАРУЖЕНО{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}{'═' * 70}{Colors.RESET}")
    return True


def test_gemini_api(api_key: str) -> bool:
    print_header(f"ТЕСТИРОВАНИЕ GOOGLE GEMINI API ({mask_key(api_key)})")

    print_step(1, "Проверяю доступность сервера Google AI...")
    try:
        response = requests.get(
            f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}",
            timeout=10,
        )
    except Exception as exc:  # noqa: BLE001
        print_error(f"Не удалось подключиться к серверу: {exc}")
        return False

    if response.status_code != 200:
        if response.status_code == 400:
            print_error("API ключ неверный или недействительный")
        elif response.status_code == 403:
            print_error("Доступ запрещен - возможна блокировка по IP")
        else:
            print_error(f"Сервер вернул код {response.status_code}")
            print_info("Ответ сервера", response.text[:200])
        return False

    print_success("Сервер Google AI доступен!")
    print_info("Статус код", "200 OK")
    print_info("Время ответа", f"{response.elapsed.total_seconds():.2f} секунд")

    print_step(2, "Получаю список доступных моделей Gemini...")
    try:
        data = response.json()
        models = [model["name"] for model in data.get("models", [])]
        print_success(f"Доступно {len(models)} моделей")
        gemini_models = [model for model in models if "gemini" in model.lower()]
        if gemini_models:
            print_info("Модели Gemini", ", ".join([model.split("/")[-1] for model in gemini_models[:5]]))
    except Exception as exc:  # noqa: BLE001
        print_error(f"Не удалось получить список моделей: {exc}")

    print_step(3, "Отправляю тестовое сообщение к Gemini Pro...")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={api_key}"
    payload = {"contents": [{"parts": [{"text": "Ответь одним словом: работает ли API?"}]}]}
    headers = {"Content-Type": "application/json"}

    try:
        completion = requests.post(url, json=payload, headers=headers, timeout=30)
    except Exception as exc:  # noqa: BLE001
        print_error(f"Ошибка при отправке запроса: {exc}")
        return False

    if completion.status_code != 200:
        print_error(f"Ошибка при запросе. Код: {completion.status_code}")
        print_info("Детали ошибки", completion.text[:300])
        return False

    try:
        data = completion.json()
        message = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as exc:  # noqa: BLE001
        print_error(f"Не удалось получить ответ от модели: {exc}")
        return False

    print_success("Получен ответ от Gemini!")
    print_info("Ответ модели", f'"{message.strip()}"')
    print_info("Модель", "gemini-pro")
    print_info("Время обработки", f"{completion.elapsed.total_seconds():.2f} сек")

    print(f"\n{Colors.BOLD}{Colors.GREEN}{'═' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}РЕЗУЛЬТАТ: Google Gemini API функционирует!{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Сервер доступен{Colors.RESET}")
    print(f"{Colors.GREEN}✓ API ключ работает{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Модели доступны{Colors.RESET}")
    print(f"{Colors.GREEN}✓ Запросы обрабатываются корректно{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.GREEN}{'═' * 70}{Colors.RESET}")

    return True


# New function for generic Gemini GET request
def check_gemini_get_request(api_key: str, endpoint_url_path: str) -> bool:
    print_header(f"ТЕСТИРОВАНИЕ GOOGLE GEMINI GET-ЗАПРОСА К /{endpoint_url_path} ({mask_key(api_key)})")

    base_url = "https://generativelanguage.googleapis.com/v1beta/"
    full_url = f"{base_url}{endpoint_url_path}?key={api_key}"

    print_step(1, f"Отправляю GET запрос к {full_url}...")
    try:
        response = requests.get(full_url, timeout=15)
    except requests.exceptions.ConnectionError as exc:
        print_error(
            f"Ошибка подключения: Не удалось связаться с сервером {base_url}. Возможно, проблемы с сетью или сервер недоступен. Детали: {exc}"
        )
        return False
    except requests.exceptions.Timeout:
        print_error(f"Превышено время ожидания при подключении к {base_url}. Попробуйте позже.")
        return False
    except Exception as exc:  # noqa: BLE001
        print_error(f"Произошла непредвиденная ошибка при отправке запроса: {exc}")
        return False

    if response.status_code == 200:
        print_success(f"GET запрос к /{endpoint_url_path} успешен!")
        print_info("Статус код", "200 OK")
        print_info("Время ответа", f"{response.elapsed.total_seconds():.2f} секунд")
        try:
            json_response = response.json()
            preview = str(json_response)
            print_info("Часть ответа (JSON)", preview[:500] + ("..." if len(preview) > 500 else ""))
        except ValueError:
            print_info("Часть ответа (текст)", response.text[:500] + ("..." if len(response.text) > 500 else ""))
        return True

    error_message = f"GET запрос к /{endpoint_url_path} завершился с ошибкой. Код: {response.status_code}"
    if response.status_code == 400:
        error_message += " (Неверный запрос или ключ)"
    elif response.status_code == 403:
        error_message += " (Доступ запрещен - возможна блокировка по IP или проблемы с API ключом)"
    elif response.status_code == 404:
        error_message += " (Ресурс не найден)"

    print_error(error_message)
    print_info("Ответ сервера", response.text[:500] + ("..." if len(response.text) > 500 else ""))
    return False


def run_for_keys(
    openai_keys: List[str], gemini_keys: List[str], gemini_get_url: Optional[str] = None
) -> Tuple[List[bool], List[bool]]:
    openai_results: List[bool] = []
    gemini_results: List[bool] = []

    if openai_keys:
        for index, key in enumerate(openai_keys, start=1):
            print_header(f"OPENAI КЛЮЧ {index}/{len(openai_keys)}")
            openai_results.append(test_openai_api(key))
    else:
        print_header("OPENAI КЛЮЧИ НЕ ПЕРЕДАНЫ – ПРОПУСКАЮ")

    if gemini_get_url:
        if gemini_keys:
            print_header("Выполняется пользовательский GET-запрос Gemini")
            gemini_results.append(check_gemini_get_request(gemini_keys[0], gemini_get_url))
        else:
            print_error("Необходимо предоставить ключ Gemini для выполнения пользовательского GET-запроса.")
    elif gemini_keys:
        for index, key in enumerate(gemini_keys, start=1):
            print_header(f"GEMINI КЛЮЧ {index}/{len(gemini_keys)}")
            gemini_results.append(test_gemini_api(key))
    else:
        print_header("GEMINI КЛЮЧИ НЕ ПЕРЕДАНЫ – ПРОПУСКАЮ")

    return openai_results, gemini_results


def print_final_report(openai_results: List[bool], gemini_results: List[bool], ip_info: Optional[dict]) -> None:
    print_header("ИТОГОВЫЙ ОТЧЕТ")
    if ip_info:
        print(f"{Colors.BOLD}Тестирование с IP:{Colors.RESET} {ip_info.get('ip')}")
        print(f"{Colors.BOLD}Местоположение:{Colors.RESET} {ip_info.get('city')}, {ip_info.get('country_name')}")

    print(f"\n{Colors.BOLD}Результаты тестов:{Colors.RESET}")

    if openai_results:
        for idx, result in enumerate(openai_results, start=1):
            status = f"✅ OpenAI ключ {idx} - РАБОТАЕТ" if result else f"❌ OpenAI ключ {idx} - НЕ РАБОТАЕТ"
            print(status)
    else:
        print("⚠️  OpenAI GPT API - ПРОПУЩЕНО")

    if gemini_results:
        for idx, result in enumerate(gemini_results, start=1):
            status = f"✅ Google Gemini ключ {idx} - РАБОТАЕТ" if result else f"❌ Google Gemini ключ {idx} - НЕ РАБОТАЕТ"
            print(status)
    else:
        print("⚠️  Google Gemini API - ПРОПУЩЕНО")

    if openai_results and all(openai_results) and gemini_results and all(gemini_results):
        print(f"\n{Colors.BOLD}{Colors.GREEN}{'=' * 70}{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.GREEN}🎉 ОТЛИЧНО! Оба API работают без ограничений!{Colors.RESET}")
        print(f"{Colors.GREEN}Запросы успешно проходят с вашего местоположения.{Colors.RESET}")
        print(f"{Colors.BOLD}{Colors.GREEN}{'=' * 70}{Colors.RESET}\n")
    else:
        print(f"\n{Colors.YELLOW}⚠️  Обнаружены проблемы. Проверьте детали выше.{Colors.RESET}\n")


def main(argv: List[str] | None = None) -> None:
    argv = argv if argv is not None else sys.argv[1:]
    key_set, skip_ip_check, gemini_get_url = parse_args(argv)

    print(
        f"\n{Colors.BOLD}{'=' * 70}{Colors.RESET}\n"
        f"{Colors.BOLD}  ДЕТАЛЬНАЯ ПРОВЕРКА API - OpenAI GPT и Google Gemini{Colors.RESET}\n"
        f"{Colors.BOLD}  Время запуска: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{Colors.RESET}\n"
        f"{Colors.BOLD}{'=' * 70}{Colors.RESET}"
    )

    ip_info = check_ip_location(skip=skip_ip_check)
    openai_results, gemini_results = run_for_keys(
        key_set.openai_keys, key_set.gemini_keys, gemini_get_url=gemini_get_url
    )
    print_final_report(openai_results, gemini_results, ip_info)


if __name__ == "__main__":
    main()
