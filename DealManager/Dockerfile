﻿# Базовый runtime-образ
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 80

# SDK-образ для сборки
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Копируем все файлы в контейнер
COPY . .

# Сборка проекта
RUN dotnet publish -c Release -o /app

# Финальный контейнер
FROM base AS final
WORKDIR /app
COPY --from=build /app .
CMD ["dotnet", "DealManager.dll"]