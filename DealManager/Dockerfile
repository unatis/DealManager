# 1. Use the official .NET SDK image for building
FROM mcr.microsoft.com/dotnet/sdk:7.0 AS build

WORKDIR /src

# Copy csproj and restore dependencies first (caching layer)
COPY *.csproj ./
RUN dotnet restore

# Copy the rest of the project
COPY . ./

# Build and publish the app
RUN dotnet publish -c Release -o /app/publish

# 2. Use the official .NET runtime image for running
FROM mcr.microsoft.com/dotnet/aspnet:7.0 AS runtime

WORKDIR /app

# Copy published files from the build stage
COPY --from=build /app/publish .

# Expose port (Render sets PORT environment variable)
EXPOSE 10000

# Run the app
CMD ["dotnet", "DealManager.dll"]